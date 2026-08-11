/**
 * Exporta TODA la base de datos actual (MySQL de Hostinger) a un backup JSON.
 * Solo lectura: no modifica nada en producción.
 *
 * Uso:  node scripts/export-datos.js
 * Salida: backups/backup-<timestamp>.json  +  backups/backup-<timestamp>.sql
 *
 * Los Decimal se serializan como STRING para no perder precisión al pasar
 * por JSON (un Number de JS no representa exactamente todos los decimales).
 */
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// Cliente MySQL dedicado (schema.mysql.prisma). No usamos @prisma/client
// porque desde el cutover ese cliente apunta a PostgreSQL.
const { PrismaClient } = require(path.join(
  __dirname,
  "..",
  "node_modules",
  ".prisma",
  "client-mysql"
));

const prisma = new PrismaClient();

const BACKUP_DIR = path.join(__dirname, "..", "backups");

// Decimal (objeto Decimal.js de Prisma) y BigInt -> string exacto
function replacer(key, value) {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "object" && typeof value.toFixed === "function" && !(value instanceof Date)) {
    return value.toString(); // Decimal
  }
  return value;
}

function sqlLiteral(v) {
  if (v === null || v === undefined) return "NULL";
  if (v instanceof Date) return `'${v.toISOString().slice(0, 19).replace("T", " ")}'`;
  if (typeof v === "number") return String(v);
  if (typeof v === "object" && typeof v.toFixed === "function") return v.toString();
  return `'${String(v).replace(/'/g, "''")}'`;
}

async function main() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const customers = await prisma.customer.findMany({ orderBy: { id: "asc" } });
  const movements = await prisma.customerMovement.findMany({ orderBy: { id: "asc" } });

  // Chequeo de integridad referencial antes de exportar
  const idsClientes = new Set(customers.map((c) => c.id));
  const huerfanos = movements.filter((m) => !idsClientes.has(m.customerId));

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  const payload = {
    exportadoEn: new Date().toISOString(),
    origen: "mysql / Hostinger",
    conteos: { customers: customers.length, movements: movements.length },
    huerfanos: huerfanos.map((m) => m.id),
    customers,
    movements,
  };

  const jsonPath = path.join(BACKUP_DIR, `backup-${stamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(payload, replacer, 2), "utf8");

  // Copia legible en SQL como respaldo redundante
  const lines = [
    `-- Backup de u686118396_gestor (MySQL/Hostinger) - ${new Date().toISOString()}`,
    `-- ${customers.length} clientes, ${movements.length} movimientos`,
    "",
  ];
  for (const c of customers) {
    lines.push(
      `INSERT INTO Customer (id,name,address,phone,city,currentAccountBalance,createdAt,updatedAt) VALUES (` +
        [c.id, c.name, c.address, c.phone, c.city, c.currentAccountBalance, c.createdAt, c.updatedAt]
          .map(sqlLiteral)
          .join(",") +
        ");"
    );
  }
  lines.push("");
  for (const m of movements) {
    lines.push(
      `INSERT INTO CustomerMovement (id,customerId,type,amount,date,method,description,createdAt) VALUES (` +
        [m.id, m.customerId, m.type, m.amount, m.date, m.method, m.description, m.createdAt]
          .map(sqlLiteral)
          .join(",") +
        ");"
    );
  }
  const sqlPath = path.join(BACKUP_DIR, `backup-${stamp}.sql`);
  fs.writeFileSync(sqlPath, lines.join("\n"), "utf8");

  // Saldo total según la regla de negocio (DEBIT suma, CREDIT resta).
  // Sirve como "huella" para comparar contra Supabase después de importar.
  const saldoTotal = movements.reduce((acc, m) => {
    const amt = Number(m.amount);
    return m.type === "DEBIT" ? acc + amt : m.type === "CREDIT" ? acc - amt : acc;
  }, 0);

  console.log(`OK  clientes    : ${customers.length}`);
  console.log(`OK  movimientos : ${movements.length}`);
  console.log(`OK  huerfanos   : ${huerfanos.length}${huerfanos.length ? " -> " + huerfanos.join(",") : ""}`);
  console.log(`OK  saldo total : ${saldoTotal.toFixed(2)}   <-- huella a verificar tras migrar`);
  console.log(`\nJSON: ${jsonPath}`);
  console.log(`SQL : ${sqlPath}`);
}

main()
  .catch((e) => {
    console.error("FALLO EL EXPORT:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
