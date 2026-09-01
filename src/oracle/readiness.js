export const REQUIRED_ORACLE_READY_FIELDS = Object.freeze([
  'brand',
  'model',
  'size',
  'price',
  'quantity',
  'confirmed_availability'
]);

export function missingOracleReadyFields(item) {
  const missing = [];
  if (!String(item?.brand || '').trim()) missing.push('brand');
  if (!String(item?.model || '').trim()) missing.push('model');
  if (!String(item?.size || '').trim()) missing.push('size');

  const price = Number(item?.price);
  if (!Number.isFinite(price) || price <= 0) missing.push('price');

  const quantity = Number(item?.stock_quantity);
  if (!Number.isInteger(quantity) || quantity <= 0) missing.push('quantity');
  if (item?.availability !== 'ready_stock') missing.push('confirmed_availability');
  return missing;
}

export function isOracleReadyItem(item) {
  return missingOracleReadyFields(item).length === 0;
}

export function buildOracleQuotationPayload(item, { tyreId = null } = {}) {
  const missing = missingOracleReadyFields(item);
  if (missing.length > 0) {
    throw new Error(`Quotation is incomplete: missing ${missing.join(', ')}.`);
  }

  return {
    ...(tyreId ? { tyre_id: tyreId } : {}),
    brand: String(item.brand).trim(),
    model: String(item.model).trim(),
    size: String(item.size).trim(),
    price: Math.round(Number(item.price) * 100) / 100,
    stock_quantity: Number(item.stock_quantity),
    availability: 'ready_stock',
    ...(item.year_of_manufacture ? { year_of_manufacture: item.year_of_manufacture } : {}),
    ...(item.country_of_origin ? { country_of_origin: item.country_of_origin } : {}),
    is_commercial: item.is_commercial === true,
    quoted_at: item.quoted_at
  };
}
