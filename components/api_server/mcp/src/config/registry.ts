import { Request, Response } from "express";
import { UPSTREAM_BASE_URL } from "./env";
import { exchangeAthenzAT } from "../utils/exchange-athenz-at"

export type HttpMethod = "get" | "post" | "put" | "delete";

export interface ToolDefinition {
  path: string;
  method: HttpMethod;
  operationId: string;
  summary: string;
  description: string;
  scope: string; // required scope for that specific endpoint
  pathParamSchemas?: Record<string, any>;
  requestBodySchema?: any;
  handler: (req: Request, res: Response, scope: string) => Promise<void>;
}

export const toolsRegistry: ToolDefinition[] = [
  {
    path: "/api/docs",
    method: "get",
    operationId: "get_k8s_docs",
    summary: "Get Kubernetes Documents",
    description: "Get the list of documents from the API running on local Kubernetes.",
    scope: "api:role.docs-getter",
    handler: async (req, res, scope) => {
      try {
        const at = await exchangeAthenzAT(req, scope)
        
        const response = await fetch(`${UPSTREAM_BASE_URL}/api/docs`, {
          headers: {
            "Authorization": `Bearer ${at}`,
            "Content-Type": "application/json",
          },
        });
        
        const data = await response.text();
        res.status(response.status).send(data);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  },
  {
    path: "/api/docs/{doc_id}",
    method: "delete",
    operationId: "delete_k8s_doc",
    summary: "Delete Kubernetes Document",
    description: "Delete a document with the specified ID from the API running on local Kubernetes. IMPORTANT: doc_id must be the numeric integer ID. If you only know the document name, call get_k8s_docs first to look up the ID, then use that integer ID here.",
    scope: "api:role.docs-deleter",
    pathParamSchemas: {
      doc_id: {
        type: "integer",
        minimum: 1,
        description: "Document ID. Pass only the numeric ID, for example 5.",
      },
    },
    handler: async (req, res, scope) => {
      try {
        const docId = req.params.doc_id;
        const at = await exchangeAthenzAT(req, scope)
        
        const response = await fetch(`${UPSTREAM_BASE_URL}/api/docs/${docId}`, {
          method: "DELETE",
          headers: {
            "Authorization": `Bearer ${at}`,
            "Content-Type": "application/json",
          },
        });
        
        const data = await response.text();
        res.status(response.status).send(data);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  },
  {
    path: "/api/docs",
    method: "post",
    operationId: "post_k8s_doc",
    summary: "Post Kubernetes Document",
    description: "Post a new document to the API running on local Kubernetes.",
    requestBodySchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "title of the document" },
        content: { type: "string", description: "content of the document" },
      },
      required: ["name", "content"],
    },
    scope: "api:role.docs-poster",
    handler: async (req, res, scope) => {
      try {
        const at = await exchangeAthenzAT(req, scope)

        const response = await fetch(`${UPSTREAM_BASE_URL}/api/docs`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${at}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(req.body),
        });

        const data = await response.text();
        res.status(response.status).send(data);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  },
];
