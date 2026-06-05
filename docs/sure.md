# Export to [Sure](https://github.com/we-promise/sure)

Export transactions to a self-hosted Sure server using Sure's transaction CSV import API.

Use the following configuration to setup:

```typescript
storage: {
  sure?: {
    /**
     * The URL of your Sure server, for example "http://sup2kk:3000"
     */
    serverUrl: string;
    /**
     * A Sure API key with read_write scope
     */
    apiKey: string;
    /**
     * Optional API base path. Defaults to "/api/v1".
     */
    apiBasePath?: string;
    /**
     * A key-value list to correlate each moneyman account with the Sure account ID
     */
    accounts: Record<string, string>;
  };
};
```

## accounts

A `JSON` key-value pair structure representing a mapping between two identifiers. The `key` represents the account ID as understood by moneyman (from web scraping the financial institutions) and the `value` is the account ID from your Sure server.

Example:

```json
{
  "5897": "42"
}
```

## Notes

Moneyman sends one `TransactionImport` CSV per Sure account with `publish=true`. Pending transactions are skipped. Sure's import API does not currently return duplicate counts for published CSV imports, so accepted rows are counted as added.

The CSV columns sent to Sure are `Date`, `Amount`, `Description`, `Notes`, and `Currency`. Moneyman appends `moneyman_unique_id` and `moneyman_hash` to the Sure notes field so imported rows remain traceable.
