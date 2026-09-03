// POST /api/questions/vote  { id, sessionId }  -> toggle the current user's upvote
const { app } = require("@azure/functions");
const { container, principal } = require("../../shared/cosmos");

app.http("vote", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "questions/vote",
  handler: async (req) => {
    const user = principal(req);
    if (!user) return { status: 401, jsonBody: { error: "Authentication required." } };

    let body;
    try { body = await req.json(); } catch { body = {}; }
    const id = (body.id || "").toString();
    const sessionId = (body.sessionId || "").toString();
    if (!id || !sessionId) return { status: 400, jsonBody: { error: "id and sessionId are required." } };

    const c = await container("questions");
    let q;
    try {
      ({ resource: q } = await c.item(id, sessionId).read());
    } catch (e) {
      if (e.code === 404) q = null; else throw e;
    }
    if (!q) return { status: 404, jsonBody: { error: "Question not found." } };

    q.voters = q.voters || [];
    const i = q.voters.indexOf(user.userId);
    if (i >= 0) q.voters.splice(i, 1);
    else q.voters.push(user.userId);

    await c.item(id, sessionId).replace(q);
    return { jsonBody: { id, votes: q.voters.length, hasVoted: q.voters.indexOf(user.userId) >= 0 } };
  }
});
