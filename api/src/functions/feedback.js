// GET  /api/feedback?sessionId=...  -> aggregates for a session + this user's own submission
// POST /api/feedback  { sessionId, rating, tags[], comment }  -> upsert this user's feedback, returns aggregates
const { app } = require("@azure/functions");
const { container, principal } = require("../../shared/cosmos");

function aggregate(rows, userId) {
  const dist = [0, 0, 0, 0, 0];
  const tally = {};
  let sum = 0;
  let mine = null;
  for (const f of rows) {
    if (f.rating >= 1 && f.rating <= 5) { dist[f.rating - 1]++; sum += f.rating; }
    (f.tags || []).forEach((t) => { tally[t] = (tally[t] || 0) + 1; });
    if (f.userId === userId) mine = { rating: f.rating, tags: f.tags || [], comment: f.comment || "" };
  }
  const count = rows.length;
  return {
    count,
    average: count ? sum / count : 0,
    distribution: dist,       // index 0 => 1 star ... index 4 => 5 stars
    tags: tally,
    mine
  };
}

app.http("feedback", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  route: "feedback",
  handler: async (req) => {
    const user = principal(req);
    if (!user) return { status: 401, jsonBody: { error: "Authentication required." } };

    const c = await container("feedback");

    let sessionId;
    if (req.method === "POST") {
      let body;
      try { body = await req.json(); } catch { body = {}; }
      sessionId = (body.sessionId || "").toString();
      const rating = Number(body.rating);
      if (!sessionId) return { status: 400, jsonBody: { error: "sessionId is required." } };
      if (!(rating >= 1 && rating <= 5)) return { status: 400, jsonBody: { error: "rating must be 1-5." } };

      const item = {
        id: `${sessionId}::${user.userId}`, // one submission per user per session
        sessionId,
        userId: user.userId,
        userName: user.userDetails || "",
        rating,
        tags: Array.isArray(body.tags) ? body.tags.slice(0, 12) : [],
        comment: (body.comment || "").toString().slice(0, 400),
        createdAt: Date.now()
      };
      await c.items.upsert(item);
    } else {
      sessionId = req.query.get("sessionId");
      if (!sessionId) return { status: 400, jsonBody: { error: "sessionId is required." } };
    }

    const { resources } = await c.items.query({
      query: "SELECT * FROM c WHERE c.sessionId = @s",
      parameters: [{ name: "@s", value: sessionId }]
    }, { partitionKey: sessionId }).fetchAll();

    return { jsonBody: aggregate(resources, user.userId) };
  }
});
