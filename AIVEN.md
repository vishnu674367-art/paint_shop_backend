# Connect to Aiven MySQL

1. In the Aiven console, open the MySQL service and copy its current hostname, port, user, and database from the service's connection information.
2. Set those values in `.env`. Use `DB_SSL=true` and set `DB_SSL_CA=certs\aiven-ca.pem` to verify the Aiven CA certificate.
3. Ensure the service is running and your network is allowed to access it. The hostname must resolve from your machine; if startup reports `ENOTFOUND`, replace `DB_HOST` with the current hostname from Aiven.
4. Run `npm start`.

When `DB_NAME` is set, the backend connects directly to that existing database and creates its tables there. Without `DB_NAME`, it retains the local-development behavior of creating `paint_shop_db`.

See `.env.example` for the expected environment variable names. Do not commit `.env` or share its credentials.
