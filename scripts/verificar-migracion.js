/**
 * Compara fila por fila y campo por campo MySQL (Hostinger) contra
 * PostgreSQL (Supabase). Solo lectura en ambas bases.
 *
 * Uso: node scripts/verificar-migracion.js
 *
 * Sale con código 1 si encuentra CUALQUIER diferencia, así que sirve como
 * criterio objetivo para decidir si el cutover es seguro.
 */
const path = require("path");
require("dotenv").config();

const { PrismaClient: MysqlClient } = require(path.join(
  __dirname,
  "..",
  "node_modules",
  ".prisma",
  "client-mysql"
));
const { PrismaClient: PgClient } = require(path.join(
  __dirname,
  "..",
  "node_modules",
  ".prisma",
  "client-pg"
));

const norm = (v) => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object" && typeof v.toFixed === "function") return v.toString(); // Decimal
  return v;
};

const saldo = (movs) =>
  movs.reduce((acc, m) => {
    const a = Number(m.amount);
    return m.type === "DEBIT" ? acc + a : m.type === "CREDIT" ? acc - a : acc;
  }, 0);

async function main() {
  const my = new MysqlClient();
  const pg = new PgClient();
  const diffs = [];

  try {
    const [myC, pgC, myM, pgM] = await Promise.all([
      my.customer.findMany({ orderBy: { id: "asc" } }),
      pg.customer.findMany({ orderBy: { id: "asc" } }),
      my.customerMovement.findMany({ orderBy: { id: "asc" } }),
      pg.customerMovement.findMany({ orderBy: { id: "asc" } }),
    ]);

    console.log(`clientes    MySQL ${myC.length}  ->  Supabase ${pgC.length}`);
    console.log(`movimientos MySQL ${myM.length}  ->  Supabase ${pgM.length}\n`);

    const comparar = (tabla, a, b, campos) => {
      const mapa = new Map(b.map((r) => [r.id, r]));
      for (const orig of a) {
        const dest = mapa.get(orig.id);
        if (!dest) {
          diffs.push(`${tabla} id=${orig.id}: FALTA en Supabase`);
          continue;
        }
        for (const f of campos) {
          const x = norm(orig[f]);
          const y = norm(dest[f]);
          if (x !== y) diffs.push(`${tabla} id=${orig.id} campo "${f}": MySQL=${x} / Supabase=${y}`);
        }
        mapa.delete(orig.id);
      }
      for (const sobrante of mapa.keys()) {
        diffs.push(`${tabla} id=${sobrante}: SOBRA en Supabase (no existe en MySQL)`);
      }
    };

    comparar("Customer", myC, pgC, [
      "name", "address", "phone", "city", "currentAccountBalance", "createdAt", "updatedAt",
    ]);
    comparar("CustomerMovement", myM, pgM, [
      "customerId", "type", "amount", "date", "method", "description", "createdAt",
    ]);

    const sMy = saldo(myM);
    const sPg = saldo(pgM);
    console.log(`saldo total MySQL    : ${sMy.toFixed(2)}`);
    console.log(`saldo total Supabase : ${sPg.toFixed(2)}`);
    if (sMy !== sPg) diffs.push(`SALDO TOTAL no coincide (${sMy} vs ${sPg})`);

    console.log("");
    if (diffs.length) {
      console.error(`FALLÓ LA VERIFICACIÓN - ${diffs.length} diferencia(s):`);
      diffs.slice(0, 40).forEach((d) => console.error("  - " + d));
      if (diffs.length > 40) console.error(`  ... y ${diffs.length - 40} más`);
      process.exitCode = 1;
    } else {
      console.log("VERIFICACIÓN OK: las dos bases son idénticas campo por campo.");
    }
  } finally {
    await Promise.all([my.$disconnect(), pg.$disconnect()]);
  }
}

main().catch((e) => {
  console.error("ERROR AL VERIFICAR:", e.message);
  process.exitCode = 1;
});
