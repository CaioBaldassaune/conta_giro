// Intentionally empty by default.
// Add Drizzle tables here when the site actually needs a database.
// See examples/d1/db/schema.ts for an opt-in example.
import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), name: text("name").notNull(), createdAt: text("created_at").notNull(),
}, t => [uniqueIndex("idx_workspace_owner").on(t.ownerId)]);
export const members = sqliteTable("members", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), userId: text("user_id").notNull(), email: text("email").notNull(), role: text("role").notNull(), companyId: text("company_id"),
}, t => [uniqueIndex("idx_members_identity").on(t.workspaceId,t.userId), index("idx_members_user").on(t.userId)]);
export const companies = sqliteTable("companies", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), name: text("name").notNull(), data: text("data").notNull(), version: integer("version").notNull().default(0),
}, t => [index("idx_companies_workspace").on(t.workspaceId)]);
export const records = sqliteTable("records", {
  id: text("id").primaryKey(), companyId: text("company_id").notNull(), kind: text("kind").notNull(), period: text("period").notNull(), data: text("data").notNull(), updatedAt: text("updated_at").notNull(),
}, t => [index("idx_records_company_kind_period").on(t.companyId,t.kind,t.period)]);
export const audit = sqliteTable("audit", {
  id: text("id").primaryKey(), companyId: text("company_id").notNull(), actorId: text("actor_id").notNull(), actorEmail: text("actor_email").notNull(), action: text("action").notNull(), detail: text("detail").notNull(), createdAt: text("created_at").notNull(),
}, t => [index("idx_audit_company_time").on(t.companyId,t.createdAt)]);
