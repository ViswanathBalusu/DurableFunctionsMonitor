// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System.IO.Compression;
using Azure.Storage.Blobs;

namespace DurableFunctionsMonitor.DotNetIsolated
{
    /// <summary>
    /// Reads and removes the gzipped payload blobs the Durable Task Framework keeps outside its tables:
    /// a history column above 60 KB is moved into the '{taskhub}-largemessages' container and referenced
    /// by a '{Column}BlobName' column, while the XXXInstances table stores the blob's URL in the column itself.
    /// </summary>
    static class LargeMessageBlobs
    {
        /// <summary>
        /// Suffix of the history columns that point to an offloaded payload (e.g. 'InputBlobName')
        /// </summary>
        public const string BlobNameColumnSuffix = "BlobName";

        public static string GetContainerName(string hubName)
        {
            return $"{hubName.ToLowerInvariant()}-largemessages";
        }

        /// <summary>
        /// Whether a field value is a reference to an offloaded payload rather than the payload itself.
        /// Mirrors the framework's own check (MessageManager.TryGetLargeMessageReference).
        /// </summary>
        public static bool IsUrl(string value)
        {
            return !string.IsNullOrEmpty(value) && Uri.IsWellFormedUriString(value, UriKind.Absolute);
        }

        /// <summary>
        /// Downloads and decompresses a payload addressed by the name stored in a '*BlobName' column
        /// </summary>
        public static Task<string> DownloadByNameAsync(string connEnvVariableName, string hubName, string blobName)
        {
            var blob = GetContainer(connEnvVariableName, hubName).GetBlobClient(blobName);

            return DownloadAndDecompressAsync(blob);
        }

        /// <summary>
        /// Downloads and decompresses a payload addressed by an absolute URL, after checking that the URL
        /// points into our own Storage account
        /// </summary>
        public static Task<string> DownloadByUrlAsync(string connEnvVariableName, string blobUrl)
        {
            var blobServiceClient = Globals.GetBlobServiceClient(connEnvVariableName);

            // Important check, to make sure we're not trying to access anything other than our own blob storage
            CheckBlobUrl(blobUrl, blobServiceClient.Uri);

            // Addressing the blob through our already-authenticated service client, rather than by
            // absolute URL. Note that for a secondary (RA-GRS) URL this reads the primary replica.
            var (containerName, blobName) = SplitBlobUrl(blobServiceClient.Uri, blobUrl);
            var blob = blobServiceClient.GetBlobContainerClient(containerName).GetBlobClient(blobName);

            return DownloadAndDecompressAsync(blob);
        }

        /// <summary>
        /// Deletes an offloaded payload. Best effort: an orphaned blob only costs storage, so a failure here
        /// must not fail the operation that made the blob obsolete.
        /// </summary>
        public static async Task<bool> TryDeleteByNameAsync(string connEnvVariableName, string hubName, string blobName)
        {
            try
            {
                await GetContainer(connEnvVariableName, hubName).GetBlobClient(blobName).DeleteIfExistsAsync();
                return true;
            }
            catch (Exception)
            {
                return false;
            }
        }

        internal static void CheckBlobUrl(string blobUrl, Uri blobServiceUri)
        {
            blobUrl = blobUrl.ToLower();

            // The trailing slash matters. BlobServiceClient.Uri only sometimes carries one - a
            // connection string with an explicit BlobEndpoint yields e.g.
            // "http://127.0.0.1:10000/devstoreaccount1" with no slash - and without it this prefix
            // test would also accept "https://myaccount.blob.core.windows.net.evil.com/...".
            string primaryUri = EndWithSlash(blobServiceUri.ToString().ToLower());
            string secondaryUri = Globals.GetSecondaryBlobServiceUri(blobServiceUri)?.ToString().ToLower();
            secondaryUri = string.IsNullOrEmpty(secondaryUri) ? primaryUri : EndWithSlash(secondaryUri);

            if (!blobUrl.StartsWith(primaryUri) && !blobUrl.StartsWith(secondaryUri))
            {
                throw new NotSupportedException("The field value is not a valid blob URL");
            }
        }

        /// <summary>
        /// Splits an absolute blob URL into its container name and blob name, relative to the
        /// Blob service endpoint. Only ever called after CheckBlobUrl() has confirmed the URL
        /// belongs to this account.
        /// </summary>
        internal static (string ContainerName, string BlobName) SplitBlobUrl(Uri blobServiceUri, string blobUrl)
        {
            string path = new Uri(blobUrl).AbsolutePath;

            // The emulator puts the account name in the path (http://127.0.0.1:10000/devstoreaccount1/...),
            // so strip whatever path the service endpoint itself carries.
            string basePath = blobServiceUri.AbsolutePath.TrimEnd('/');
            if (basePath.Length > 0 && path.StartsWith(basePath, StringComparison.OrdinalIgnoreCase))
            {
                path = path.Substring(basePath.Length);
            }

            path = path.TrimStart('/');

            int slashIdx = path.IndexOf('/');
            if (slashIdx < 0)
            {
                throw new NotSupportedException("The field value is not a valid blob URL");
            }

            // Blob names are percent-encoded in the URL, but BlobContainerClient wants them decoded
            return (Uri.UnescapeDataString(path.Substring(0, slashIdx)), Uri.UnescapeDataString(path.Substring(slashIdx + 1)));
        }

        private static BlobContainerClient GetContainer(string connEnvVariableName, string hubName)
        {
            return Globals.GetBlobServiceClient(connEnvVariableName).GetBlobContainerClient(GetContainerName(hubName));
        }

        private static string EndWithSlash(string uri)
        {
            return uri.EndsWith("/") ? uri : uri + "/";
        }

        private static async Task<string> DownloadAndDecompressAsync(BlobClient blob)
        {
            using (var memoryStream = new MemoryStream())
            {
                await blob.DownloadToAsync(memoryStream);
                memoryStream.Position = 0;

                using (var gzipStream = new GZipStream(memoryStream, CompressionMode.Decompress))
                using (var streamReader = new StreamReader(gzipStream))
                {
                    return await streamReader.ReadToEndAsync();
                }
            }
        }
    }
}
