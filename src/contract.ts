import AjvModule from 'ajv'
import type { Json } from './types.js'

const Ajv = (AjvModule as any).default ?? AjvModule
const ajv = new Ajv({ allErrors: true, strict: false, removeAdditional: false })
export function assertContractSchema(contract: Json | undefined, label: string): void {
  if (contract === undefined || contract === null) return
  try {
    ajv.compile(contract as object)
  } catch (error) {
    throw new Error(
      `${label}_CONTRACT_INVALID: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
export function assertContract(contract: Json | undefined, value: Json, label: string): void {
  if (contract === undefined || contract === null) return
  let validate: any
  try {
    validate = ajv.compile(contract as object)
  } catch (error) {
    throw new Error(
      `${label}_CONTRACT_INVALID: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!validate(value))
    throw new Error(`${label}_CONTRACT_FAILED: ${ajv.errorsText(validate.errors)}`)
}
