import { z } from 'zod';
const won = z.number().int().nonnegative().max(1e13);
const rate = z.number().min(0).max(100);
export const simulatorSchema = z.object({
  type: z.enum(['villa', 'residentialOffice', 'businessOffice']),
  bid: won.positive(),
  sale: won.positive(),
  operating: won,
  capital: won,
  selling: won,
  financing: won,
  acquisitionRate: rate,
  educationRate: rate,
  ruralRate: rate,
  purchaseVatRate: rate,
  saleVatRate: rate,
  buildingShare: rate,
  inputCreditRate: rate,
  purchaseIncludesVat: z.boolean(),
  saleIncludesVat: z.boolean(),
  corporateRate: rate,
  housingAdditionalRate: rate,
  localCorporateRate: rate,
  housingGainAdjustment: z.number().int().min(-1e13).max(1e13),
  localOnAdditional: z.boolean(),
  assumptionsConfirmed: z.boolean(),
  note: z.string().max(4000),
});
export type SimulationInput = z.infer<typeof simulatorSchema>;
export const simulationDefaults: SimulationInput = {
  type: 'villa',
  bid: 100000000,
  sale: 140000000,
  operating: 0,
  capital: 0,
  selling: 0,
  financing: 0,
  acquisitionRate: 0,
  educationRate: 0,
  ruralRate: 0,
  purchaseVatRate: 0,
  saleVatRate: 0,
  buildingShare: 0,
  inputCreditRate: 0,
  purchaseIncludesVat: true,
  saleIncludesVat: true,
  corporateRate: 0,
  housingAdditionalRate: 0,
  localCorporateRate: 0,
  housingGainAdjustment: 0,
  localOnAdditional: false,
  assumptionsConfirmed: false,
  note: '',
};
export const calculationVersion = 'corporate-cashflow-v1';
export function simulate(raw: SimulationInput) {
  const i = simulatorSchema.parse(raw),
    r = (v: number) => v / 100,
    round = (v: number) => Math.round(v);
  const purchaseNet = i.purchaseIncludesVat
    ? i.bid / (1 + r(i.buildingShare) * r(i.purchaseVatRate))
    : i.bid;
  const purchaseVat = round(purchaseNet * r(i.buildingShare) * r(i.purchaseVatRate));
  const saleNet = i.saleIncludesVat ? i.sale / (1 + r(i.buildingShare) * r(i.saleVatRate)) : i.sale;
  const saleVat = round(saleNet * r(i.buildingShare) * r(i.saleVatRate));
  const purchaseCash = round(purchaseNet) + purchaseVat,
    saleCash = round(saleNet) + saleVat;
  const acquisition = round(purchaseNet * r(i.acquisitionRate)),
    education = round(purchaseNet * r(i.educationRate)),
    rural = round(purchaseNet * r(i.ruralRate));
  const acquisitionTotal = acquisition + education + rural,
    inputCredit = round(purchaseVat * r(i.inputCreditRate)),
    nonRecoverableVat = purchaseVat - inputCredit,
    vatSettlement = saleVat - inputCredit;
  const costBasis = round(purchaseNet) + acquisitionTotal + nonRecoverableVat + i.capital;
  const propertyGain = round(saleNet) - costBasis,
    taxableProfit = propertyGain - i.operating - i.selling - i.financing;
  const generalCorporate = round(Math.max(taxableProfit, 0) * r(i.corporateRate));
  const housingBase =
    i.type === 'businessOffice' ? 0 : Math.max(propertyGain + i.housingGainAdjustment, 0);
  const housingAdditional = round(housingBase * r(i.housingAdditionalRate));
  const localCorporate = round(
    (generalCorporate + (i.localOnAdditional ? housingAdditional : 0)) * r(i.localCorporateRate),
  );
  const netProfit =
    saleCash -
    purchaseCash -
    acquisitionTotal -
    i.operating -
    i.capital -
    i.selling -
    i.financing -
    vatSettlement -
    generalCorporate -
    housingAdditional -
    localCorporate;
  return {
    version: calculationVersion,
    purchaseNet: round(purchaseNet),
    saleNet: round(saleNet),
    purchaseVat,
    saleVat,
    inputCredit,
    nonRecoverableVat,
    vatSettlement,
    purchaseCash,
    saleCash,
    acquisition,
    education,
    rural,
    acquisitionTotal,
    costBasis,
    propertyGain,
    taxableProfit,
    housingBase,
    generalCorporate,
    housingAdditional,
    localCorporate,
    netProfit,
    roi:
      netProfit /
      (purchaseCash + acquisitionTotal + i.operating + i.capital + i.selling + i.financing),
    taxTotal:
      acquisitionTotal + vatSettlement + generalCorporate + housingAdditional + localCorporate,
  };
}
