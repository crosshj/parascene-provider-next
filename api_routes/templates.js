import express from "express";

export default function createTemplatesRoutes({ queries }) {
  const router = express.Router();

  router.get("/api/templates", async (req, res) => {
    if (!req.auth?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const user = await queries.selectUserById.get(req.auth?.userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const templates = await queries.selectTemplates.all();
    return res.json({ templates });
  });

  return router;
}
