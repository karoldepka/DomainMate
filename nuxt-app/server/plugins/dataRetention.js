import { scheduleDataRetentionSweep } from '../utils/dataRetention.js'

export default defineNitroPlugin(() => {
  scheduleDataRetentionSweep()
})
