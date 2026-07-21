/** 一次性补写：deno run --allow-env repair_once.ts [task_id] */
import { sweepPendingFootprintsForTask } from './voiceFootprint.ts'

const taskId = Deno.args[0]?.trim() || 'task_70b1ff7c7f0a466c'
await sweepPendingFootprintsForTask(taskId)
console.log('sweep done', taskId)
