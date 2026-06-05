import assert from "node:assert";
import { format, parseISO } from "date-fns";
import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";
import type { MoneymanConfig } from "../../config.js";
import type { TransactionRow, TransactionStorage } from "../../types.js";
import { createLogger } from "../../utils/logger.js";
import { formatUnknownError } from "../../utils/utils.js";
import { createSaveStats } from "../saveStats.js";

const SURE_DATE_FORMAT = "yyyy-MM-dd";
const SURE_IMPORT_DATE_FORMAT = "%Y-%m-%d";
const DEFAULT_API_BASE_PATH = "/api/v1";
const logger = createLogger("SureStorage");

type SureImportResponse = {
  data?: {
    id?: string | number;
    stats?: {
      rows_count?: number;
      valid_rows_count?: number;
    };
  };
};

export class SureStorage implements TransactionStorage {
  private accountToSureAccount = new Map<string, string>();

  constructor(private config: MoneymanConfig) {}

  canSave() {
    return Boolean(this.config.storage.sure);
  }

  async saveTransactions(
    txns: Array<TransactionRow>,
    onProgress: (status: string) => Promise<void>,
  ) {
    this.init();

    const sureConfig = this.config.storage.sure;
    assert(sureConfig, "Sure configuration not found");

    const stats = createSaveStats(
      "SureStorage",
      `server: "${sureConfig.serverUrl}"`,
      txns,
    );
    const txnsByAccount = new Map<string, TransactionRow[]>();
    const missingAccounts = new Set<string>();

    for (const tx of txns) {
      if (tx.status === TransactionStatuses.Pending) {
        continue;
      }

      const sureAccountId = this.accountToSureAccount.get(tx.account);
      if (!sureAccountId) {
        missingAccounts.add(tx.account);
        stats.otherSkipped++;
        continue;
      }

      if (!txnsByAccount.has(sureAccountId)) {
        txnsByAccount.set(sureAccountId, []);
      }
      txnsByAccount.get(sureAccountId)!.push(tx);
    }

    for (const [sureAccountId, accountTxns] of txnsByAccount) {
      const [response] = await Promise.all([
        this.createTransactionImport(sureAccountId, accountTxns),
        onProgress(`Sending transactions for Sure account "${sureAccountId}"`),
      ]);

      stats.added +=
        response.data?.stats?.valid_rows_count ??
        response.data?.stats?.rows_count ??
        accountTxns.length;
    }

    if (missingAccounts.size > 0) {
      logger("Accounts missing in Sure accounts mapping:", missingAccounts);
    }

    return stats;
  }

  private init() {
    const sureConfig = this.config.storage.sure;
    assert(sureConfig, "Sure configuration not found");
    this.accountToSureAccount = new Map(Object.entries(sureConfig.accounts));
  }

  private async createTransactionImport(
    sureAccountId: string,
    txns: TransactionRow[],
  ): Promise<SureImportResponse> {
    const sureConfig = this.config.storage.sure;
    assert(sureConfig, "Sure configuration not found");

    const url = this.sureApiUrl("/imports");
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": sureConfig.apiKey,
      },
      body: JSON.stringify({
        type: "TransactionImport",
        account_id: sureAccountId,
        raw_file_content: this.toCsv(txns),
        publish: "true",
        date_col_label: "Date",
        amount_col_label: "Amount",
        name_col_label: "Description",
        notes_col_label: "Notes",
        currency_col_label: "Currency",
        date_format: SURE_IMPORT_DATE_FORMAT,
        number_format: "1,234.56",
        signage_convention: "inflows_positive",
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Failed to create Sure import for account "${sureAccountId}": ${response.status} ${response.statusText}${body ? ` - ${body}` : ""}`,
      );
    }

    try {
      return (await response.json()) as SureImportResponse;
    } catch (error) {
      throw new Error(
        `Failed to parse Sure import response: ${formatUnknownError(error)}`,
      );
    }
  }

  private sureApiUrl(path: string) {
    const sureConfig = this.config.storage.sure;
    assert(sureConfig, "Sure configuration not found");

    const serverUrl = sureConfig.serverUrl.replace(/\/+$/, "");
    const apiBasePath = (
      sureConfig.apiBasePath ?? DEFAULT_API_BASE_PATH
    ).replace(/^\/?/, "/");
    return `${serverUrl}${apiBasePath.replace(/\/+$/, "")}${path}`;
  }

  private toCsv(txns: TransactionRow[]) {
    const rows = txns.map((tx) => [
      format(parseISO(tx.date), SURE_DATE_FORMAT, {}),
      tx.chargedAmount.toFixed(2),
      tx.description,
      this.notes(tx),
      tx.chargedCurrency,
    ]);

    return [["Date", "Amount", "Description", "Notes", "Currency"], ...rows]
      .map((row) => row.map(csvEscape).join(","))
      .join("\n");
  }

  private notes(tx: TransactionRow) {
    return [
      tx.memo,
      `moneyman_unique_id=${tx.uniqueId}`,
      `moneyman_hash=${tx.hash}`,
    ]
      .filter(Boolean)
      .join("\n");
  }
}

function csvEscape(value: string | number | undefined) {
  const stringValue = String(value ?? "");
  if (!/[",\n\r]/.test(stringValue)) {
    return stringValue;
  }
  return `"${stringValue.replaceAll('"', '""')}"`;
}
