// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using Azure;
using Azure.Data.Tables;

namespace DurableFunctionsMonitor.DotNetIsolated
{
    // TableServiceClient wrapper interface. Seems to be the only way to unit-test.
    public interface ITableClient
    {
        // Gets the list of table names
        Task<IEnumerable<string>> ListTableNamesAsync();

        // Synchronously retrieves all entities matching an OData filter (null == no filter).
        // Intentionally lazy - the consuming code does not always iterate through all of it.
        IEnumerable<TableEntity> GetAll(string tableName, string filter);

        // Asynchronously retrieves all entities matching an OData filter (null == no filter)
        Task<IEnumerable<TableEntity>> GetAllAsync(string tableName, string filter);

        // Asynchronously retrieves all entities matching an OData filter (null == no filter)
        Task<IEnumerable<TableEntity>> GetAllAsync(string tableName, string filter, CancellationToken ct);

        // Retrieves a single entity, or null if it does not exist
        Task<TableEntity> GetEntityAsync(string tableName, string partitionKey, string rowKey);

        // Replaces an entity. Fails if the entity was modified after it was read.
        Task ReplaceEntityAsync(string tableName, TableEntity entity);

        // Inserts an entity, or replaces it regardless of when it was last modified
        Task UpsertEntityAsync(string tableName, TableEntity entity);

        // Deletes entities, all of which must share one partition key, in transaction batches
        Task DeleteEntitiesAsync(string tableName, IEnumerable<TableEntity> entities);
    }

    // TableServiceClient wrapper. Seems to be the only way to unit-test.
    class TableClient : ITableClient
    {
        // Cannot use DI functionality (our startup method will not be called when installed as a NuGet package),
        // so just leaving this as an internal static variable.
        internal static ITableClient MockedTableClient = null;

        /// <summary>
        /// Custom value for 'User-Agent' header for requests to Azure Storage.
        /// Will only be applied to DfMon's 'native' requests (e.g. retrieving instance history or getting parentInstanceId),
        /// not to all requests DfMon makes. Still might be useful to track activity via Storage logs.
        /// </summary>
        public static string CustomUserAgent { get; set; }

        public static ITableClient GetTableClient(string connStringName)
        {
            if (MockedTableClient != null)
            {
                return MockedTableClient;
            }

            var options = new TableClientOptions();
            Globals.ApplyCustomUserAgent(options);

            string connectionString = Environment.GetEnvironmentVariable(connStringName);
            if (string.IsNullOrEmpty(connectionString))
            {
                // Trying with Managed Identity/local Azure login

                string tableServiceUri = Environment.GetEnvironmentVariable(connStringName + Globals.IdentityBasedConnectionSettingTableServiceUriSuffix);
                if (string.IsNullOrEmpty(tableServiceUri))
                {
                    string accountName = Environment.GetEnvironmentVariable(connStringName + Globals.IdentityBasedConnectionSettingAccountNameSuffix);
                    tableServiceUri = $"https://{accountName}.table.core.windows.net";
                }

                return new TableClient(new TableServiceClient(new Uri(tableServiceUri), IdentityBasedTokenSource.GetCredential(), options));
            }
            else
            {
                // Using classic connection string
                return new TableClient(new TableServiceClient(connectionString, options));
            }
        }

        private TableClient(TableServiceClient client)
        {
            this._client = client;
        }

        /// <inheritdoc/>
        public async Task<IEnumerable<string>> ListTableNamesAsync()
        {
            var result = new List<string>();

            // AsyncPageable transparently follows continuation tokens
            await foreach (var table in this._client.QueryAsync())
            {
                result.Add(table.Name);
            }

            return result;
        }

        /// <inheritdoc/>
        public IEnumerable<TableEntity> GetAll(string tableName, string filter)
        {
            // Pageable only fetches the next page once the current one is exhausted,
            // so abandoning this enumeration early also stops querying.
            return this._client.GetTableClient(tableName).Query<TableEntity>(filter);
        }

        /// <inheritdoc/>
        public Task<IEnumerable<TableEntity>> GetAllAsync(string tableName, string filter)
            => this.GetAllAsync(tableName, filter, CancellationToken.None);

        /// <inheritdoc/>
        public async Task<IEnumerable<TableEntity>> GetAllAsync(string tableName, string filter, CancellationToken ct)
        {
            var result = new List<TableEntity>();

            await foreach (var entity in this._client.GetTableClient(tableName).QueryAsync<TableEntity>(filter, cancellationToken: ct))
            {
                result.Add(entity);
            }

            return result;
        }

        /// <inheritdoc/>
        public async Task<TableEntity> GetEntityAsync(string tableName, string partitionKey, string rowKey)
        {
            // GetEntityIfExistsAsync (rather than GetEntityAsync) so that a missing entity comes
            // back as null instead of throwing, which is what the legacy TableOperation.Retrieve did.
            var response = await this._client.GetTableClient(tableName).GetEntityIfExistsAsync<TableEntity>(partitionKey, rowKey);

            return response.HasValue ? response.Value : null;
        }

        /// <inheritdoc/>
        public Task ReplaceEntityAsync(string tableName, TableEntity entity)
        {
            // Passing the entity's own ETag keeps the optimistic concurrency check that
            // the legacy TableOperation.Replace performed.
            return this._client.GetTableClient(tableName).UpdateEntityAsync(entity, entity.ETag, TableUpdateMode.Replace);
        }

        /// <inheritdoc/>
        public Task UpsertEntityAsync(string tableName, TableEntity entity)
        {
            return this._client.GetTableClient(tableName).UpsertEntityAsync(entity, TableUpdateMode.Replace);
        }

        /// <inheritdoc/>
        public async Task DeleteEntitiesAsync(string tableName, IEnumerable<TableEntity> entities)
        {
            var table = this._client.GetTableClient(tableName);

            foreach (var batch in SplitIntoBatches(entities.ToList(), MaxTransactionSize))
            {
                var actions = batch
                    .Select(e => new TableTransactionAction(TableTransactionActionType.Delete, e, ETag.All))
                    .ToList();

                await table.SubmitTransactionAsync(actions);
            }
        }

        // A table transaction takes at most 100 operations, all within one partition. The remainder goes first, so that
        // the last batch is always a full one: a caller that orders the entities so the ones that matter most come last
        // gets those deleted together, in a single all-or-nothing transaction.
        internal static IEnumerable<List<TableEntity>> SplitIntoBatches(List<TableEntity> entities, int batchSize)
        {
            int position = 0;

            int remainder = entities.Count % batchSize;
            if (remainder > 0)
            {
                yield return entities.GetRange(0, remainder);
                position = remainder;
            }

            while (position < entities.Count)
            {
                yield return entities.GetRange(position, batchSize);
                position += batchSize;
            }
        }

        private const int MaxTransactionSize = 100;

        private readonly TableServiceClient _client;
    }
}
