import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { normalize } from '../../src/domain/journal';
const a = '11111111-1111-4111-8111-111111111111',
  b = '22222222-2222-4222-8222-222222222222';
let pg: PGlite;
const fields = normalize({
  court: '서울중앙지방법원',
  caseNumber: '2026타경SQL',
  itemNumber: '1',
  auctionDate: '2026-10-01',
  forecastDate: '2026-09-01',
  predictedPrice: 105000000,
  beforeResultConfirmed: true,
});
async function user(id: string) {
  await pg.exec(`reset role; set role authenticated; set request.jwt.claim.sub='${id}';`);
}
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`create role authenticated;create role anon;create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${a}'),('${b}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
 create function storage.foldername(text) returns text[] language sql immutable as $$select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1]$$;
 grant usage on schema public,storage to authenticated,anon;grant select,insert,delete on storage.objects to authenticated;`);
  await pg.exec(readFileSync('supabase/migrations/202611040001_madang.sql', 'utf8'));
}, 30000);
afterAll(async () => {
  await pg.close();
});
let recordId: string;
describe.sequential('actual PostgreSQL migration, RLS and triggers (PGlite)', () => {
  it('creates a record atomically with audit history and rejects prediction edits', async () => {
    await user(a);
    const result = await pg.query<{ id: string }>(
      'select (public.create_auction_record($1::jsonb,$2::uuid[],$3::uuid[],$4::jsonb)).id as id',
      [JSON.stringify(fields), [], [], JSON.stringify({ reviewed: true })],
    );
    recordId = result.rows[0].id;
    expect((await pg.query('select * from public.record_history')).rows).toHaveLength(1);
    await expect(
      pg.query(
        "update public.auction_records set fields=jsonb_set(fields,'{predictedPrice}','1') where id=$1",
        [recordId],
      ),
    ).rejects.toThrow(/최초 예측/);
    await pg.query('update public.auction_records set fields=fields||$1::jsonb where id=$2', [
      JSON.stringify({ saleResult: '낙찰', actualPrice: 100000000 }),
      recordId,
    ]);
    expect((await pg.query('select * from public.record_history')).rows).toHaveLength(2);
  });
  it('isolates records, source metadata, transactions, simulations and history by user', async () => {
    await user(b);
    for (const table of [
      'auction_records',
      'record_history',
      'documents',
      'analyses',
      'transactions',
      'simulations',
      'analysis_reviews',
    ])
      expect((await pg.query('select * from public.' + table)).rows).toHaveLength(0);
    await expect(
      pg.query(
        "insert into public.transactions(record_id,price,contract_date,reviewed)values($1,1,'2026-10-01',true)",
        [recordId],
      ),
    ).rejects.toThrow();
    await expect(
      pg.query(
        "insert into public.auction_records(owner_id,court,case_number,item_number,auction_date,fields)values($1,'x','x','1','2026-10-01',$2)",
        [a, JSON.stringify(fields)],
      ),
    ).rejects.toThrow();
  });
  it('restricts private storage and prevents another user linking a source', async () => {
    const id = '33333333-3333-4333-8333-333333333333',
      path = `${a}/${id}/original`;
    await user(a);
    await pg.query(
      "insert into public.documents(id,name,path,mime_type,size)values($1,'test.pdf',$2,'application/pdf',10)",
      [id, path],
    );
    await pg.query("insert into storage.objects(bucket_id,name)values('auction-documents',$1)", [
      path,
    ]);
    await user(b);
    expect((await pg.query('select * from storage.objects')).rows).toHaveLength(0);
    await expect(
      pg.query("insert into storage.objects(bucket_id,name)values('auction-documents',$1)", [path]),
    ).rejects.toThrow();
    await expect(
      pg.query(
        "insert into public.analyses(mode,document_ids,model,result)values('auction',$1,'test','{}')",
        [[id]],
      ),
    ).rejects.toThrow(/소유자/);
  });
  it('rolls back an entire failed CSV import and preserves existing duplicate rows', async () => {
    await user(a);
    const good = { ...fields, caseNumber: 'NEW-SQL' },
      bad = { ...fields, caseNumber: 'BAD-SQL', predictedPrice: -1 };
    await expect(
      pg.query('select public.import_auction_records($1)', [
        JSON.stringify([{ fields: good }, { fields: bad }]),
      ]),
    ).rejects.toThrow();
    expect((await pg.query('select * from public.auction_records')).rows).toHaveLength(1);
    const r = await pg.query<{ result: { inserted: number; skipped: number } }>(
      'select public.import_auction_records($1) as result',
      [JSON.stringify([{ fields: good }, { fields }])],
    );
    expect(r.rows[0].result).toEqual({ inserted: 1, skipped: 1 });
  });
  it('rolls back the record and its audit if linking a draft document fails', async () => {
    await user(a);
    const count = (await pg.query('select * from public.auction_records')).rows.length,
      history = (await pg.query('select * from public.record_history')).rows.length;
    await expect(
      pg.query('select public.create_auction_record($1,$2::uuid[],$3::uuid[],$4)', [
        JSON.stringify({ ...fields, caseNumber: 'ROLLBACK' }),
        ['99999999-9999-4999-8999-999999999999'],
        [],
        JSON.stringify({ reviewed: true }),
      ]),
    ).rejects.toThrow(/원본 자료/);
    expect((await pg.query('select * from public.auction_records')).rows).toHaveLength(count);
    expect((await pg.query('select * from public.record_history')).rows).toHaveLength(history);
  });
  it('bounds analysis quota per user and does not grant anonymous access', async () => {
    await user(a);
    for (let i = 0; i < 5; i++)
      expect(
        (await pg.query<{ ok: boolean }>('select public.claim_analysis_request() as ok')).rows[0]
          .ok,
      ).toBe(true);
    expect(
      (await pg.query<{ ok: boolean }>('select public.claim_analysis_request() as ok')).rows[0].ok,
    ).toBe(false);
    await pg.exec('reset role;set role anon;');
    await expect(pg.query('select * from public.auction_records')).rejects.toThrow();
  });
});
