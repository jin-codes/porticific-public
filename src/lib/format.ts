export const usd = (n: number | null | undefined) =>
  n == null ? '–' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })

export const num = (n: number | null | undefined, digits = 2) =>
  n == null ? '–' : n.toLocaleString('en-US', { maximumFractionDigits: digits })

export const pct = (n: number | null | undefined) => (n == null ? '–' : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`)

export const pnlClass = (n: number | null | undefined) =>
  n == null || n === 0 ? '' : n > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'

export const SIGNAL_LABEL: Record<string, string> = {
  add_more: '추가매수',
  hold: '보유',
  watch: '관찰필요',
  trim: '비중축소',
  sell: '매도',
  urgent_sell: '긴급매도',
  avoid_chasing: '추격매수금지',
  buy: '매수',
  buy_wait: '매수보류',
  drop_watch: '관심제외',
}

export const SIGNAL_TONE: Record<string, string> = {
  add_more: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  buy: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  hold: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  watch: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  avoid_chasing: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  buy_wait: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  trim: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  sell: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  urgent_sell: 'bg-red-200 text-red-900 dark:bg-red-900/60 dark:text-red-200',
  drop_watch: 'bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400',
}

export const CLAIM_LABEL: Record<string, string> = {
  unchecked: '미점검',
  intact: '유효',
  weakened: '약화',
  broken: '붕괴',
}

export const CLAIM_TONE: Record<string, string> = {
  unchecked: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400',
  intact: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  weakened: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  broken: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
}

/** Roll-up level (thesisHealth) shown on the dashboard. */
export const HEALTH_LABEL: Record<string, string> = {
  no_claims: '주장 없음',
  unchecked: '미점검',
  intact: '유효',
  at_risk: '주의',
  broken: '붕괴',
}

export const HEALTH_TONE: Record<string, string> = {
  no_claims: 'text-neutral-400',
  unchecked: CLAIM_TONE.unchecked,
  intact: CLAIM_TONE.intact,
  at_risk: CLAIM_TONE.weakened,
  broken: CLAIM_TONE.broken,
}
