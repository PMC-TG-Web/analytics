const COMMITMENT_CATEGORY_PATTERN =
  /\bfoundation\b|\bfooting\b|spread footing|stem wall|\bwall\b|\bvertical\b|\bsog\b|\bslab\b|interior floor|\bfloor\b|\bsite\b|\bsidewalk\b|\bpatio\b|\bporch\b|\blanding\b|\bturndown\b|\bexterior\b/;

function normalizeContext(value: unknown) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function resolveCommitmentMappingContext(suffixContext: unknown, contractContext: unknown) {
  const suffix = normalizeContext(suffixContext);
  const contract = normalizeContext(contractContext);
  const hasExplicitLineItemCategory = COMMITMENT_CATEGORY_PATTERN.test(suffix);
  const context = hasExplicitLineItemCategory ? suffix : `${suffix} ${contract}`.trim();

  return {
    context,
    source: hasExplicitLineItemCategory ? "line_item_suffix" : "line_item_and_contract",
    wantsFoundation: /foundation|footing|spread footing|stem wall/.test(context),
    wantsWall: /\bwall\b|vertical/.test(context),
    wantsSog: /\bsog\b|slab|interior floor|floor/.test(context),
    wantsSite: /\bsite\b|sidewalk|patio|porch|landing|turndown|exterior/.test(context),
  };
}
