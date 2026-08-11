/**
 * Importa el backup JSON a la base PostgreSQL de Supabase.
 *
 * Requisitos previos:
 *   1. DATABASE_URL_PG en .env (cadena de conexión de Supabase)
 *   2. npx prisma db push --schema=prisma/schema.postgres.prisma
 *
 * Uso:
 *   node scripts/import-supabase.js                    # usa el backup más reciente
 *   node scripts/import-supabase.js backups/backup-X.json
 *
 * Es IDEMPOTENTE: vacía las tablas destino antes de insertar, así que se puede
 * correr las veces que haga falta. Nunca toca la base MySQL de origen.
 *
 * Conserva los IDs originales (hay huecos por borrados previos) y después
 * reajusta las secuencias, si no el próximo alta chocaría con un ID existente.
 */
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const { PrismaClient } = require(path.join(
  __dirname,
  "..",
  "node_modules",
  ".prisma",
  "client-pg"
));

const BACKUP_DIR = path.join(__dirname, "..", "backups");

function ultimoBackup() {
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("backup-") && f.endsWith(".json"))
    .sort();
  if (!files.length) throw new Error("No hay backups en backups/. Corré primero: node scripts/export-datos.js");
  return path.join(BACKUP_DIR, files[files.length - 1]);
}

async function main() {
  if (!process.env.DATABASE_URL_PG) {
    throw new Error("Falta DATABASE_URL_PG en .env");
  }

  const file = process.argv[2] ? path.resolve(process.argv[2]) : ultimoBackup();
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  console.log(`Backup   : ${path.basename(file)}`);
  console.log(`Contiene : ${data.customers.length} clientes, ${data.movements.length} movimientos\n`);

  const prisma = new PrismaClient();

  try {
    // Limpieza previa (movimientos primero por la FK)
    await prisma.customerMovement.deleteMany({});
    await prisma.customer.deleteMany({});

    // Los Decimal viajan como string en el JSON; Prisma los acepta tal cual
    // y los convierte sin pasar por float, que es justamente lo que queremos.
    await prisma.customer.createMany({
      data: data.customers.map((c) => ({
        id: c.id,
        name: c.name,
        address: c.address,
        phone: c.phone,
        city: c.city,
        currentAccountBalance: c.currentAccountBalance,
        createdAt: new Date(c.createdAt),
        updatedAt: new Date(c.updatedAt),
      })),
    });
    console.log(`Insertados ${data.customers.length} clientes`);

    await prisma.customerMovement.createMany({
      data: data.movements.map((m) => ({
        id: m.id,
        customerId: m.customerId,
        type: m.type,
        amount: m.amount,
        date: new Date(m.date),
        method: m.method,
        description: m.description,
        createdAt: new Date(m.createdAt),
      })),
    });
    console.log(`Insertados ${data.movements.length} movimientos`);

    // Reajustar secuencias: sin esto, el próximo INSERT arrancaría en id=1
    // y chocaría contra los IDs que acabamos de importar.
    for (const tabla of ["Customer", "CustomerMovement"]) {
      await prisma.$executeRawUnsafe(
        `SELECT setval(pg_get_serial_sequence('"${tabla}"', 'id'),
                       COALESCE((SELECT MAX(id) FROM "${tabla}"), 1))`
      );
    }
    const seqs = await prisma.$queryRawUnsafe(
      `SELECT last_value FROM "Customer_id_seq"`
    );
    console.log(`\nSecuencias reajustadas (Customer.id sigue en ${seqs[0].last_value})`);
    console.log("\nListo. Ahora verificá con: node scripts/verificar-migracion.js");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("\nFALLO EL IMPORT:", e.message);
  process.exitCode = 1;
});
