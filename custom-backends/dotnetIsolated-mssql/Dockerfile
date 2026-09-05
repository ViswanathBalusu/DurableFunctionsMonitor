# NOTE: this Dockerfile expects the REPO ROOT as its build context, because the project
# references durablefunctionsmonitor.dotnetisolated.core (and friends) by project reference:
#
#   docker build -f custom-backends/dotnetIsolated-mssql/Dockerfile .

# The UI is built here rather than copied in. DfmStatics is build output: it is kept out of the build
# context (.dockerignore), so what an image serves is the UI of this commit, never whatever a
# developer happened to leave in their working tree.
FROM node:22-alpine AS ui

WORKDIR /src/durablefunctionsmonitor.svelte

# The manifests first, so `npm ci` is only re-run when the dependencies themselves change
COPY durablefunctionsmonitor.svelte/package.json durablefunctionsmonitor.svelte/package-lock.json ./
RUN npm ci

COPY durablefunctionsmonitor.svelte/ ./
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS installer-env

COPY . /src

# What the backend serves (contracts section 2): the one JS and one CSS bundle of the stage above.
# All three images read their statics from this one folder - the two custom backends link it in.
COPY --from=ui /src/durablefunctionsmonitor.svelte/build /src/durablefunctionsmonitor.dotnetisolated/DfmStatics

RUN cd /src && \
    mkdir -p /home/site/wwwroot && \
    dotnet publish custom-backends/dotnetIsolated-mssql/Dfm.DotNetIsolatedMsSql.csproj --output /home/site/wwwroot

FROM mcr.microsoft.com/azure-functions/dotnet-isolated:4-dotnet-isolated10.0
ENV AzureWebJobsScriptRoot=/home/site/wwwroot \
    AzureFunctionsJobHost__Logging__Console__IsEnabled=true

COPY --from=installer-env ["/home/site/wwwroot", "/home/site/wwwroot"]
