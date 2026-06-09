-- ERP-style PostgreSQL schema covering schemas, tables, views, materialised
-- views, functions, triggers, sequences, ENUM types, and rich foreign-key
-- constraints. Used as the PostgreSQL prong of the medium-tier fixture.

CREATE SCHEMA auth;
CREATE SCHEMA billing;

CREATE TYPE auth.user_role AS ENUM ('admin', 'staff', 'customer');

CREATE DOMAIN billing.money_amount AS NUMERIC(14, 2);

CREATE SEQUENCE billing.invoice_number_seq START WITH 1000 INCREMENT BY 1;

CREATE TABLE auth.users (
    id         BIGSERIAL PRIMARY KEY,
    email      VARCHAR(255) NOT NULL UNIQUE,
    full_name  VARCHAR(255) NOT NULL,
    role       auth.user_role NOT NULL DEFAULT 'customer',
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE billing.customers (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    company     VARCHAR(255),
    vat_id      VARCHAR(64),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE billing.products (
    id          BIGSERIAL PRIMARY KEY,
    sku         VARCHAR(64) NOT NULL UNIQUE,
    name        VARCHAR(255) NOT NULL,
    unit_price  billing.money_amount NOT NULL,
    active      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE billing.invoices (
    id           BIGINT PRIMARY KEY DEFAULT nextval('billing.invoice_number_seq'),
    customer_id  BIGINT NOT NULL REFERENCES billing.customers(id),
    issued_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    due_at       TIMESTAMPTZ NOT NULL,
    total        billing.money_amount NOT NULL,
    paid         BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE billing.invoice_lines (
    id           BIGSERIAL PRIMARY KEY,
    invoice_id   BIGINT NOT NULL REFERENCES billing.invoices(id) ON DELETE CASCADE,
    product_id   BIGINT NOT NULL REFERENCES billing.products(id),
    quantity     INTEGER NOT NULL CHECK (quantity > 0),
    line_total   billing.money_amount NOT NULL,
    FOREIGN KEY (invoice_id) REFERENCES billing.invoices(id)
);

CREATE INDEX idx_invoices_customer       ON billing.invoices(customer_id);
CREATE INDEX idx_invoice_lines_invoice   ON billing.invoice_lines(invoice_id);
CREATE UNIQUE INDEX idx_products_sku     ON billing.products(sku);

CREATE VIEW billing.unpaid_invoices AS
SELECT i.id, i.customer_id, c.user_id, i.total, i.due_at
FROM   billing.invoices i
JOIN   billing.customers c ON i.customer_id = c.id
WHERE  i.paid = FALSE;

CREATE MATERIALIZED VIEW billing.monthly_revenue AS
SELECT date_trunc('month', i.issued_at) AS month,
       SUM(i.total) AS revenue
FROM   billing.invoices i
WHERE  i.paid = TRUE
GROUP BY 1;

CREATE OR REPLACE FUNCTION billing.touch_invoice_totals()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE billing.invoices
  SET    total = (
           SELECT COALESCE(SUM(line_total), 0)
           FROM   billing.invoice_lines
           WHERE  invoice_id = NEW.invoice_id
         )
  WHERE  id = NEW.invoice_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_recalc_invoice_total
AFTER INSERT OR UPDATE ON billing.invoice_lines
FOR EACH ROW
EXECUTE FUNCTION billing.touch_invoice_totals();

CREATE OR REPLACE PROCEDURE billing.refresh_monthly_revenue()
LANGUAGE SQL
AS $$
  REFRESH MATERIALIZED VIEW billing.monthly_revenue;
$$;
