-- Additive migration. Never drops existing application tables or user data.
begin;
create table public.auction_records (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users(id),
 court text not null, case_number text not null, item_number text not null, auction_date date not null,
 fields jsonb not null check(jsonb_typeof(fields)='object'), import_context jsonb,review_context jsonb,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 identity_key text generated always as (lower(regexp_replace(court||'|'||case_number||'|'||item_number,'\s','','g'))) stored,
 unique(id,owner_id),unique(owner_id,identity_key,auction_date)
);
create table public.record_history (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),record_id uuid not null,
 action text not null,before_value jsonb,after_value jsonb,created_at timestamptz not null default now(),
 foreign key(record_id,owner_id) references public.auction_records(id,owner_id)
);
create function public.guard_record() returns trigger language plpgsql set search_path=public as $$
declare key text; value jsonb; imported boolean;
begin
 if tg_op='UPDATE' then
  if new.id<>old.id or new.owner_id<>old.owner_id or new.created_at<>old.created_at or new.import_context is distinct from old.import_context or new.review_context is distinct from old.review_context
    or (new.fields-array['saleResult','actualPrice','bidderCount','reviewNote']) is distinct from (old.fields-array['saleResult','actualPrice','bidderCount','reviewNote']) then
   raise exception '최초 예측·물건 정보·작성 시각은 변경할 수 없습니다';
  end if;
 end if;
 if new.owner_id is distinct from auth.uid() then raise exception '소유자 불일치'; end if;
 if jsonb_typeof(new.fields->'beforeResultConfirmed') is distinct from 'boolean' then raise exception '사전 예측 여부는 boolean이어야 합니다';end if;
 foreach key in array array['court','caseNumber','itemNumber','auctionDate'] loop
  if coalesce(trim(new.fields->>key),'')='' then raise exception '필수 물건 정보 누락: %',key;end if;
 end loop;
 if new.court<>new.fields->>'court' or new.case_number<>new.fields->>'caseNumber' or new.item_number<>new.fields->>'itemNumber'
   or new.auction_date::text<>new.fields->>'auctionDate' then raise exception '물건 식별 정보 불일치';end if;
 foreach key in array array['appraisal','minimumPrice','predictedPrice','virtualBid','marketPrice','extraCosts','targetProfit','actualPrice','failedAuctions','bidderCount'] loop
  value=new.fields->key;
  if value is not null and value<>'null'::jsonb then
   if jsonb_typeof(value)<>'number' then raise exception '금액·횟수는 숫자여야 합니다';end if;
   if (value::text)::numeric<0 or (value::text)::numeric>9007199254740991 or trunc((value::text)::numeric)<>(value::text)::numeric then raise exception '금액·횟수 범위 오류';end if;
  end if;
 end loop;
 if coalesce(new.fields->>'saleResult','') not in ('미확인','낙찰','유찰','변경','연기','취하','기각') then raise exception '매각 결과 오류';end if;
 if new.fields->>'saleResult'='낙찰' and coalesce((new.fields->>'actualPrice')::numeric,0)<=0 then raise exception '실제 낙찰가 필요';end if;
 if coalesce(new.fields->>'forecastDate','')<>'' then perform (new.fields->>'forecastDate')::date;end if;
 imported:=new.import_context is not null;
 if tg_op='INSERT' and not imported and new.review_context->>'reviewed' is distinct from 'true' then raise exception '원본 대조 확인 필요';end if;
 if tg_op='INSERT' and (new.fields->>'beforeResultConfirmed')::boolean then
  if coalesce(new.fields->>'forecastDate','')='' or (new.fields->>'forecastDate')::date>new.auction_date or (new.fields->>'forecastDate')::date>(now() at time zone 'Asia/Seoul')::date then raise exception '사전 예측 날짜 오류';end if;
  if not imported and (new.fields->>'saleResult'='낙찰' or coalesce((new.fields->>'actualPrice')::numeric,0)>0) then raise exception '이미 결과가 있는 기록';end if;
 end if;
 new.updated_at:=now();return new;
end $$;
create trigger validate_record before insert or update on public.auction_records for each row execute function public.guard_record();
create function public.audit_record() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.record_history(owner_id,record_id,action,before_value,after_value)
 values(new.owner_id,new.id,case when tg_op='INSERT' then '최초 기록' else '결과·복기 수정' end,case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new));
 return new;
end $$;
create trigger audit_record after insert or update on public.auction_records for each row execute function public.audit_record();

create table public.documents (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null default auth.uid() references auth.users(id),record_id uuid,
 name text not null check(length(name)<=500),path text not null unique,
 mime_type text not null check(mime_type in ('image/png','image/jpeg','image/webp','application/pdf')),
 size integer not null check(size>0 and size<=8388608),created_at timestamptz not null default now(),
 unique(id,owner_id),foreign key(record_id,owner_id) references public.auction_records(id,owner_id),
 check(split_part(path,'/',1)=owner_id::text and split_part(path,'/',2)=id::text and array_length(string_to_array(path,'/'),1)=3)
);
create table public.analyses (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null default auth.uid() references auth.users(id),
 mode text not null check(mode in ('auction','tenancy','transactions')),document_ids uuid[] not null check(cardinality(document_ids) between 1 and 3),
 model text not null,result jsonb not null check(jsonb_typeof(result)='object'),created_at timestamptz not null default now(),unique(id,owner_id)
);
create function public.guard_analysis() returns trigger language plpgsql set search_path=public as $$
begin
 if exists(select 1 from unnest(new.document_ids) d where not exists(select 1 from public.documents doc where doc.id=d and doc.owner_id=new.owner_id)) then raise exception '분석 자료 소유자 불일치';end if;
 return new;
end $$;
create trigger validate_analysis before insert on public.analyses for each row execute function public.guard_analysis();
create table public.record_analyses (
 owner_id uuid not null default auth.uid() references auth.users(id),record_id uuid not null,analysis_id uuid not null,
 primary key(record_id,analysis_id),foreign key(record_id,owner_id) references public.auction_records(id,owner_id),foreign key(analysis_id,owner_id) references public.analyses(id,owner_id)
);
create table public.analysis_reviews (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null default auth.uid() references auth.users(id),record_id uuid not null,analysis_id uuid not null,
 reviewed_value jsonb not null,reason text not null check(length(trim(reason))>0),created_at timestamptz not null default now(),
 foreign key(record_id,owner_id) references public.auction_records(id,owner_id),foreign key(analysis_id,owner_id) references public.analyses(id,owner_id)
);
create table public.transactions (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null default auth.uid() references auth.users(id),record_id uuid not null,
 price bigint not null check(price>0 and price<=9007199254740991),contract_date date not null,floor text,area numeric check(area>0),address text,
 cancelled boolean,source jsonb,reviewed boolean not null check(reviewed=true),created_at timestamptz not null default now(),
 foreign key(record_id,owner_id) references public.auction_records(id,owner_id)
);
create table public.simulations (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null default auth.uid() references auth.users(id),record_id uuid not null,
 name text not null,version text not null,input jsonb not null,output jsonb not null,created_at timestamptz not null default now(),
 foreign key(record_id,owner_id) references public.auction_records(id,owner_id),check(input @> '{"assumptionsConfirmed":true}'::jsonb)
);
create table public.analysis_limits (owner_id uuid primary key references auth.users(id),window_start timestamptz not null,requests integer not null);
create function public.claim_analysis_request() returns boolean language plpgsql security definer set search_path=public as $$
declare used integer;
begin
 if auth.uid() is null then raise exception '로그인 필요';end if;
 insert into public.analysis_limits values(auth.uid(),now(),1)
 on conflict(owner_id) do update set
 requests=case when analysis_limits.window_start<now()-interval '5 minutes' then 1 else analysis_limits.requests+1 end,
 window_start=case when analysis_limits.window_start<now()-interval '5 minutes' then now() else analysis_limits.window_start end
 returning requests into used;
 return used<=5;
end $$;
create function public.import_auction_records(items jsonb) returns jsonb language plpgsql security invoker set search_path=public as $$
declare item jsonb;f jsonb; inserted integer:=0; skipped integer:=0; affected integer;
begin
 if auth.uid() is null or jsonb_typeof(items)<>'array' or jsonb_array_length(items)>500 then raise exception '가져오기 형식·행 수 오류';end if;
 for item in select * from jsonb_array_elements(items) loop
  f=item->'fields';
  insert into public.auction_records(court,case_number,item_number,auction_date,fields,import_context)
  values(f->>'court',f->>'caseNumber',f->>'itemNumber',(f->>'auctionDate')::date,f,jsonb_build_object('source','CSV','originalRow',item->'originalRow','importedAt',now()))
  on conflict(owner_id,identity_key,auction_date) do nothing;
  get diagnostics affected=row_count;inserted:=inserted+affected;skipped:=skipped+(1-affected);
 end loop;
 return jsonb_build_object('inserted',inserted,'skipped',skipped);
end $$;
create function public.create_auction_record(payload jsonb,p_document_ids uuid[],p_analysis_ids uuid[],p_review_context jsonb) returns public.auction_records language plpgsql security invoker set search_path=public as $$
declare saved public.auction_records;doc uuid;analysis uuid;affected integer;
begin
 if auth.uid() is null or p_review_context->>'reviewed' is distinct from 'true' then raise exception '원본 대조 확인 필요';end if;
 if cardinality(p_document_ids)>3 or cardinality(p_analysis_ids)>10 then raise exception '자료 수 초과';end if;
 if (payload->>'beforeResultConfirmed')::boolean and exists(select 1 from public.analyses a where a.id=any(p_analysis_ids) and a.owner_id=auth.uid() and (a.result->'fields'->>'saleResult'='낙찰' or coalesce(a.result->'fields'->>'actualPrice','')<>'')) then
  if p_review_context->>'resultCorrected' is distinct from 'true' or coalesce(trim(p_review_context->>'reason'),'')='' then raise exception '결과 오독 확인·사유 필요';end if;
 end if;
 insert into public.auction_records(court,case_number,item_number,auction_date,fields,review_context)
 values(payload->>'court',payload->>'caseNumber',payload->>'itemNumber',(payload->>'auctionDate')::date,payload,p_review_context) returning * into saved;
 foreach doc in array p_document_ids loop
  update public.documents set record_id=saved.id where id=doc and owner_id=auth.uid() and record_id is null;
  get diagnostics affected=row_count;if affected<>1 then raise exception '원본 자료 연결 실패';end if;
 end loop;
 foreach analysis in array p_analysis_ids loop
  insert into public.record_analyses(owner_id,record_id,analysis_id) values(auth.uid(),saved.id,analysis);
 end loop;
 return saved;
end $$;

alter table public.auction_records enable row level security;
alter table public.record_history enable row level security;
alter table public.documents enable row level security;
alter table public.analyses enable row level security;
alter table public.record_analyses enable row level security;
alter table public.analysis_reviews enable row level security;
alter table public.transactions enable row level security;
alter table public.simulations enable row level security;
alter table public.analysis_limits enable row level security;
create policy own_records_read on public.auction_records for select to authenticated using(owner_id=auth.uid());
create policy own_records_insert on public.auction_records for insert to authenticated with check(owner_id=auth.uid());
create policy own_records_update on public.auction_records for update to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
create policy own_history on public.record_history for select to authenticated using(owner_id=auth.uid());
create policy own_documents_read on public.documents for select to authenticated using(owner_id=auth.uid());
create policy own_documents_insert on public.documents for insert to authenticated with check(owner_id=auth.uid());
create policy own_documents_link on public.documents for update to authenticated using(owner_id=auth.uid() and record_id is null) with check(owner_id=auth.uid());
create policy own_documents_remove_draft on public.documents for delete to authenticated using(owner_id=auth.uid() and record_id is null);
create policy own_analyses_read on public.analyses for select to authenticated using(owner_id=auth.uid());
create policy own_analyses_insert on public.analyses for insert to authenticated with check(owner_id=auth.uid());
create policy own_links_read on public.record_analyses for select to authenticated using(owner_id=auth.uid());
create policy own_links_insert on public.record_analyses for insert to authenticated with check(owner_id=auth.uid());
create policy own_reviews_read on public.analysis_reviews for select to authenticated using(owner_id=auth.uid());
create policy own_reviews_insert on public.analysis_reviews for insert to authenticated with check(owner_id=auth.uid());
create policy own_transactions_read on public.transactions for select to authenticated using(owner_id=auth.uid());
create policy own_transactions_insert on public.transactions for insert to authenticated with check(owner_id=auth.uid());
create policy own_simulations_read on public.simulations for select to authenticated using(owner_id=auth.uid());
create policy own_simulations_insert on public.simulations for insert to authenticated with check(owner_id=auth.uid());
grant select,insert,update on public.auction_records to authenticated;
grant select on public.record_history to authenticated;
grant select,insert,update,delete on public.documents to authenticated;
grant select,insert on public.analyses,public.record_analyses,public.analysis_reviews,public.transactions,public.simulations to authenticated;
revoke all on function public.claim_analysis_request(),public.import_auction_records(jsonb),public.create_auction_record(jsonb,uuid[],uuid[],jsonb) from public;
grant execute on function public.claim_analysis_request(),public.import_auction_records(jsonb),public.create_auction_record(jsonb,uuid[],uuid[],jsonb) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('auction-documents','auction-documents',false,8388608,array['image/png','image/jpeg','image/webp','application/pdf']);
create policy madang_files_read on storage.objects for select to authenticated using(bucket_id='auction-documents' and (storage.foldername(name))[1]=auth.uid()::text);
create policy madang_files_insert on storage.objects for insert to authenticated with check(bucket_id='auction-documents' and (storage.foldername(name))[1]=auth.uid()::text and exists(select 1 from public.documents d where d.path=storage.objects.name and d.owner_id=auth.uid()));
create policy madang_files_remove_draft on storage.objects for delete to authenticated using(bucket_id='auction-documents' and (storage.foldername(name))[1]=auth.uid()::text and exists(select 1 from public.documents d where d.path=storage.objects.name and d.owner_id=auth.uid() and d.record_id is null));
commit;
