import { addDays, compareDates, type BusinessDate } from "./dates";
import { MAX_ROW_PAISE, mulInt, paise, sub, type Paise } from "./money";

export const MAX_COLLECTION_DAYS = 3650;

export interface ContractTermsInput {
  principalAmount: Paise;
  dailyCollectionAmount: Paise;
  totalCollectionDays: number;
  startDate: BusinessDate;
  firstCollectionDate: BusinessDate;
}

export interface ScheduleLine {
  sequence: number;
  scheduledDate: BusinessDate;
  expectedAmount: Paise;
}

export interface ContractTerms extends ContractTermsInput {
  expectedCollectionAmount: Paise;
  expectedMargin: Paise;
  /** Date of the LAST scheduled collection (inclusive). */
  expectedEndDate: BusinessDate;
  schedule: ScheduleLine[];
}

export class ContractTermsError extends Error {
  constructor(
    message: string,
    readonly field: keyof ContractTermsInput,
  ) {
    super(message);
    this.name = "ContractTermsError";
  }
}

/**
 * Deterministically derive everything about a contract from its inputs.
 * The server calls this; client-supplied totals are never trusted.
 */
export function buildContractTerms(input: ContractTermsInput): ContractTerms {
  const { principalAmount, dailyCollectionAmount, totalCollectionDays, startDate, firstCollectionDate } = input;

  if (!Number.isSafeInteger(principalAmount) || principalAmount <= 0 || principalAmount > MAX_ROW_PAISE) {
    throw new ContractTermsError("Amount given must be a positive amount", "principalAmount");
  }
  if (!Number.isSafeInteger(dailyCollectionAmount) || dailyCollectionAmount <= 0) {
    throw new ContractTermsError("Daily collection must be a positive amount", "dailyCollectionAmount");
  }
  if (!Number.isInteger(totalCollectionDays) || totalCollectionDays < 1 || totalCollectionDays > MAX_COLLECTION_DAYS) {
    throw new ContractTermsError(`Number of days must be between 1 and ${MAX_COLLECTION_DAYS}`, "totalCollectionDays");
  }
  if (compareDates(firstCollectionDate, startDate) < 0) {
    throw new ContractTermsError("First collection date cannot be before the contract start date", "firstCollectionDate");
  }

  const expectedCollectionAmount = mulInt(dailyCollectionAmount, totalCollectionDays);
  if (expectedCollectionAmount > MAX_ROW_PAISE) {
    throw new ContractTermsError("Expected collection is too large", "dailyCollectionAmount");
  }

  const schedule: ScheduleLine[] = Array.from({ length: totalCollectionDays }, (_, i) => ({
    sequence: i + 1,
    scheduledDate: addDays(firstCollectionDate, i),
    expectedAmount: dailyCollectionAmount,
  }));

  return {
    ...input,
    principalAmount: paise(principalAmount),
    expectedCollectionAmount,
    expectedMargin: sub(expectedCollectionAmount, principalAmount),
    expectedEndDate: schedule[schedule.length - 1].scheduledDate,
    schedule,
  };
}
