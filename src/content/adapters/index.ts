// Register all ATS adapters in priority order.
// Order matters — first match wins.
import { registerAdapter, selectAdapter } from './adapter'
import { WorkdayAdapter } from './workday'
import { GreenhouseAdapter } from './greenhouse'
import { LeverAdapter } from './lever'
import { ICIMSAdapter } from './icims'
import { TaleoAdapter } from './taleo'
import { BaytAdapter } from './bayt'

registerAdapter(WorkdayAdapter)
registerAdapter(GreenhouseAdapter)
registerAdapter(LeverAdapter)
registerAdapter(ICIMSAdapter)
registerAdapter(TaleoAdapter)
registerAdapter(BaytAdapter)

export { selectAdapter }
export type { ATSAdapter } from './adapter'
