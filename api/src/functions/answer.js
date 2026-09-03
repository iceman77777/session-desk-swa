// POST /api/questions/answer  { id, sessionId }  -> toggle answered (organizer role only)
const { app } = require("@azure/functions");
const { container, principal, isOrganizer } = require("../../shared/cosmos");

app.http("answer", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "questions/answer",
  handler: async (req) => {
    const user = principal(req);
    if (!user) return { status: 401, jsonBody: { error: "Authentication required." } };
    if (!isOrganizer(user)) return { status: 403, jsonBody: { error: "Only organizers can mark questions answered." } };

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

    q.answered = !q.answered;
    q.answeredBy = q.answered ? (user.userDetails || user.userId) : null;
    await c.item(id, sessionId).replace(q);
    return { jsonBody: { id, answered: q.answered } };
  }
});
