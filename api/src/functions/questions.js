// GET  /api/questions?sessionId=...   -> list questions for a session
// POST /api/questions  { sessionId, text, name }  -> add a question
const { app } = require("@azure/functions");
const { container, principal } = require("../../shared/cosmos");

function shape(q, userId) {
  const voters = q.voters || [];
  return {
    id: q.id,
    text: q.text,
    name: q.authorName || "Anonymous",
    votes: voters.length,
    answered: !!q.answered,
    ts: q.createdAt,
    hasVoted: voters.indexOf(userId) >= 0,
    mine: q.authorId === userId
  };
}

app.http("questions", {
  methods: ["GET", "POST"],
  authLevel: "anonymous", // Static Web Apps enforces auth via staticwebapp.config.json
  route: "questions",
  handler: async (req) => {
    const user = principal(req);
    if (!user) return { status: 401, jsonBody: { error: "Authentication required." } };

    const c = await container("questions");

    if (req.method === "GET") {
      const sessionId = req.query.get("sessionId");
      if (!sessionId) return { status: 400, jsonBody: { error: "sessionId is required." } };
      const { resources } = await c.items.query({
        query: "SELECT * FROM c WHERE c.sessionId = @s",
        parameters: [{ name: "@s", value: sessionId }]
      }, { partitionKey: sessionId }).fetchAll();
      return { jsonBody: resources.map((q) => shape(q, user.userId)) };
    }

    // POST
    let body;
    try { body = await req.json(); } catch { body = {}; }
    const sessionId = (body.sessionId || "").toString();
    const text = (body.text || "").toString().trim();
    if (!sessionId) return { status: 400, jsonBody: { error: "sessionId is required." } };
    if (text.length < 5) return { status: 400, jsonBody: { error: "Question must be at least 5 characters." } };

    const item = {
      id: `${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId,
      text: text.slice(0, 280),
      authorName: (body.name || "").toString().trim().slice(0, 40),
      authorId: user.userId,
      authorDetails: user.userDetails || "",
      voters: [user.userId], // author implicitly upvotes their own question
      answered: false,
      createdAt: Date.now()
    };
    const { resource } = await c.items.create(item);
    return { status: 201, jsonBody: shape(resource, user.userId) };
  }
});
