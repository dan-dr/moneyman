import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";
import { config, transactionRow } from "../../utils/tests.js";
import { SureStorage } from "./sure.js";

const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
global.fetch = fetchMock;

const onProgress = jest
  .fn<Promise<void>, [string]>()
  .mockResolvedValue(undefined);

describe("SureStorage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              id: "import-1",
              stats: { rows_count: 1, valid_rows_count: 1 },
            },
          }),
          { status: 201, statusText: "Created" },
        ),
      ),
    );
  });

  it("posts completed transactions as a Sure transaction import", async () => {
    const mockConfig = config();
    mockConfig.storage.sure = {
      serverUrl: "http://sup2kk:3000/",
      apiKey: "sure-token",
      accounts: {
        "1234": "42",
      },
    };
    const storage = new SureStorage(mockConfig);
    const tx = transactionRow({
      date: "2026-01-30T00:00:00.000Z",
      chargedAmount: -12.3,
      description: 'Cafe, "Main"',
      memo: "breakfast",
      chargedCurrency: "ILS",
      hash: "hash-1",
      uniqueId: "unique-1",
    });

    const stats = await storage.saveTransactions([tx], onProgress);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://sup2kk:3000/api/v1/imports",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": "sure-token",
        },
      }),
    );

    const request = fetchMock.mock.calls[0][1];
    const body = JSON.parse(request?.body as string);
    expect(body).toMatchObject({
      type: "TransactionImport",
      account_id: "42",
      publish: "true",
      date_col_label: "Date",
      amount_col_label: "Amount",
      name_col_label: "Description",
      notes_col_label: "Notes",
      currency_col_label: "Currency",
      date_format: "%Y-%m-%d",
      number_format: "1,234.56",
      signage_convention: "inflows_positive",
    });
    expect(body.raw_file_content).toBe(
      [
        "Date,Amount,Description,Notes,Currency",
        '2026-01-30,-12.30,"Cafe, ""Main""","breakfast\nmoneyman_unique_id=unique-1\nmoneyman_hash=hash-1",ILS',
      ].join("\n"),
    );
    expect(stats.added).toBe(1);
    expect(stats.otherSkipped).toBe(0);
  });

  it("groups transactions by Sure account", async () => {
    const mockConfig = config();
    mockConfig.storage.sure = {
      serverUrl: "http://sure.local",
      apiKey: "sure-token",
      accounts: {
        "1234": "42",
        "5678": "99",
      },
    };
    const storage = new SureStorage(mockConfig);

    await storage.saveTransactions(
      [
        transactionRow({ account: "1234", uniqueId: "unique-1" }),
        transactionRow({ account: "5678", uniqueId: "unique-2" }),
      ],
      onProgress,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = fetchMock.mock.calls.map((call) =>
      JSON.parse(call[1]?.body as string),
    );
    expect(bodies.map((body) => body.account_id)).toEqual(["42", "99"]);
  });

  it("skips pending transactions and transactions without an account mapping", async () => {
    const mockConfig = config();
    mockConfig.storage.sure = {
      serverUrl: "http://sure.local",
      apiKey: "sure-token",
      accounts: {
        "1234": "42",
      },
    };
    const storage = new SureStorage(mockConfig);

    const stats = await storage.saveTransactions(
      [
        transactionRow({ status: TransactionStatuses.Pending }),
        transactionRow({ account: "5678" }),
      ],
      onProgress,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(stats.added).toBe(0);
    expect(stats.pending).toBe(1);
    expect(stats.otherSkipped).toBe(1);
  });

  it("supports overriding the Sure API base path", async () => {
    const mockConfig = config();
    mockConfig.storage.sure = {
      serverUrl: "http://sure.local/root",
      apiBasePath: "/custom/v1/",
      apiKey: "sure-token",
      accounts: {
        "1234": "42",
      },
    };
    const storage = new SureStorage(mockConfig);

    await storage.saveTransactions([transactionRow({})], onProgress);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://sure.local/root/custom/v1/imports",
      expect.any(Object),
    );
  });

  it("throws when Sure rejects an import", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("invalid account", {
        status: 422,
        statusText: "Unprocessable Entity",
      }),
    );
    const mockConfig = config();
    mockConfig.storage.sure = {
      serverUrl: "http://sure.local",
      apiKey: "sure-token",
      accounts: {
        "1234": "42",
      },
    };
    const storage = new SureStorage(mockConfig);

    await expect(
      storage.saveTransactions([transactionRow({})], onProgress),
    ).rejects.toThrow(
      'Failed to create Sure import for account "42": 422 Unprocessable Entity - invalid account',
    );
  });
});
