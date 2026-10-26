export function calculateBalances(group, expenses, settlements) {
  const net = new Map(group.members.map(member => [String(member._id || member), 0]));
  for (const expense of expenses) {
    const payer = String(expense.payer._id || expense.payer);
    net.set(payer, (net.get(payer) || 0) + expense.amountCents);
    for (const part of expense.allocations) {
      const member = String(part.member._id || part.member);
      net.set(member, (net.get(member) || 0) - part.amountCents);
    }
  }
  for (const settlement of settlements) {
    const from = String(settlement.from._id || settlement.from);
    const to = String(settlement.to._id || settlement.to);
    net.set(from, (net.get(from) || 0) + settlement.amountCents);
    net.set(to, (net.get(to) || 0) - settlement.amountCents);
  }
  return [...net].map(([userId, balanceCents]) => ({ userId, balanceCents }));
}

export function calculateAllocations(amountCents, split, members) {
  const ids = members.map(m => String(m._id || m));
  let allocations;
  if (!split || split.type === 'equal') {
    const selected = split?.memberIds?.length ? split.memberIds.map(String) : ids;
    if (!selected.length || selected.some(id => !ids.includes(id))) throw new Error('Choose valid group members for this split.');
    const base = Math.floor(amountCents / selected.length);
    const remainder = amountCents % selected.length;
    allocations = selected.map((member, i) => ({ member, amountCents: base + (i < remainder ? 1 : 0) }));
  } else {
    allocations = (split.allocations || []).map(item => ({ member: String(item.memberId), amountCents: 0, value: Number(split.type === 'percent' ? item.percent : item.amountCents) }));
    if (!allocations.length || allocations.some(a => !ids.includes(a.member))) throw new Error('Choose valid group members for this split.');
    if (new Set(allocations.map(a => a.member)).size !== allocations.length) throw new Error('Each member can only appear once in a split.');
    if (split.type === 'percent') {
      if (allocations.some(a => !Number.isFinite(a.value) || a.value < 0) || Math.abs(allocations.reduce((sum, a) => sum + a.value, 0) - 100) > 0.001) throw new Error('Split percentages must add up to 100%.');
      allocations = allocations.map(a => ({ ...a, amountCents: Math.floor(amountCents * a.value / 100) }));
      let remainder = amountCents - allocations.reduce((sum, a) => sum + a.amountCents, 0);
      for (let i = 0; remainder > 0; i++, remainder--) allocations[i % allocations.length].amountCents++;
    } else if (split.type === 'custom') {
      allocations = allocations.map(a => ({ member: a.member, amountCents: a.value }));
      if (allocations.some(a => !Number.isSafeInteger(a.amountCents) || a.amountCents < 0)) throw new Error('Custom splits must use non-negative whole cents.');
    } else throw new Error('Choose an equal, custom, or percentage split.');
  }
  if (allocations.reduce((sum, a) => sum + a.amountCents, 0) !== amountCents) throw new Error('Split amounts must add up exactly to the expense total.');
  return allocations.map(a => ({ member: a.member, amountCents: a.amountCents }));
}
