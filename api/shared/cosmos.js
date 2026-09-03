// Shared Cosmos DB access + Static Web Apps auth helpers.
const { CosmosClient } = require("@azure/cosmos");

const CONNECTION = process.env.COSMOS_CONNECTION_STRING;
const DB_NAME = process.env.COSMOS_DATABASE || "sessiondesk";

let _client;
let _db;
const _ensured = {};

function db() {
  if (!_db) {
    if (!CONNECTION) throw new Error("COSMOS_CONNECTION_STRING app setting is not configured.");
    _client = new CosmosClient(CONNECTION);
    _db = _client.database(DB_NAME);
  }
  return _db;
}

// Returns a container, creating the database/container on first use.
// Partition key is /sessionId for every container in this app.
async function container(name) {
  const client = _client || (db(), _client);
  if (!_ensured[name]) {
    await client.databases.createIfNotExists({ id: DB_NAME });
    await client.database(DB_NAME).containers.createIfNotExists({
      id: name,
      partitionKey: { paths: ["/sessionId"] }
    });
    _ensured[name] = true;
  }
  return db().container(name);
}

// Decode the Static Web Apps client principal (the signed-in user).
// Returns null when the request is not authenticated.
function principal(req) {
  const header = req.headers.get("x-ms-client-principal");
  if (!header) return null;
  try {
    const decoded = Buffer.from(header, "base64").toString("utf8");
    const p = JSON.parse(decoded);
    if (!p || !p.userId) return null;
    p.userRoles = p.userRoles || [];
    return p;
  } catch {
    return null;
  }
}

function isOrganizer(user) {
  return !!user && Array.isArray(user.userRoles) && user.userRoles.includes("organizer");
}

module.exports = { container, principal, isOrganizer };
