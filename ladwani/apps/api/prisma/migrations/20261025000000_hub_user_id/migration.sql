-- Link a LadWani user to the bkesari ID (Neon Auth user id) issued by the hub.
ALTER TABLE "users" ADD COLUMN "hub_user_id" TEXT;
CREATE UNIQUE INDEX "users_hub_user_id_key" ON "users"("hub_user_id");
