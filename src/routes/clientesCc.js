// server/src/routes/clientesCc.js
import { Router } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

// ----------------- HELPERS -----------------

// Convierte cualquier valor numérico a Number seguro
const toNumber = (v) => Number(v || 0);

// Calcula el saldo de un cliente a partir de sus movimientos
function calcularSaldo(movimientos = []) {
  return movimientos.reduce((acc, m) => {
    const amt = Number(m.amount || 0);
    if (m.type === "DEBIT") return acc + amt;   // deuda suma
    if (m.type === "CREDIT") return acc - amt;  // pago resta
    return acc;
  }, 0);
}

// ----------------- RUTAS DE CLIENTES -----------------

// GET /api/clientes-cc
// Lista todos los clientes con su saldo calculado
router.get("/", async (req, res, next) => {
  try {
    const customers = await prisma.customer.findMany({
      orderBy: { name: "asc" },
      include: { movements: true }, // asumimos modelo CustomerMovement
    });

    const result = customers.map((c) => ({
      id: c.id,
      name: c.name,
      address: c.address,
      phone: c.phone,
      city: c.city,
      currentAccountBalance: calcularSaldo(c.movements),
    }));

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/clientes-cc
// Crea un nuevo cliente
router.post("/", async (req, res, next) => {
  try {
    const { name, address, phone, city } = req.body || {};

    if (!name || !name.trim()) {
      return res.status(400).json({ error: "El nombre del cliente es obligatorio." });
    }

    const customer = await prisma.customer.create({
      data: {
        name: name.trim(),
        address: address?.trim() || null,
        phone: phone?.trim() || null,
        city: city?.trim() || null,
      },
    });

    res.status(201).json(customer);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/clientes-cc/:id
// Elimina un cliente y todos sus movimientos
router.delete("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ error: "ID de cliente inválido." });
    }

    // Primero eliminamos los movimientos asociados
    await prisma.customerMovement.deleteMany({
      where: { customerId: id },
    });

    // Luego el cliente
    await prisma.customer.delete({
      where: { id },
    });

    res.json({ ok: true, message: "Cliente eliminado correctamente." });
  } catch (err) {
    // Si el cliente no existe
    if (err.code === "P2025") {
      return res.status(404).json({ error: "Cliente no encontrado." });
    }
    next(err);
  }
});

// ----------------- RUTAS DE MOVIMIENTOS -----------------

// GET /api/clientes-cc/:id/movimientos
// Lista los movimientos de un cliente
router.get("/:id/movimientos", async (req, res, next) => {
  try {
    const customerId = Number(req.params.id);
    if (!customerId || Number.isNaN(customerId)) {
      return res.status(400).json({ error: "ID de cliente inválido." });
    }

    const movimientos = await prisma.customerMovement.findMany({
      where: { customerId },
      orderBy: { date: "desc" },
    });

    res.json(movimientos);
  } catch (err) {
    next(err);
  }
});

// POST /api/clientes-cc/:id/deuda
// Registra una nueva deuda (DEBIT)
router.post("/:id/deuda", async (req, res, next) => {
  try {
    const customerId = Number(req.params.id);
    if (!customerId || Number.isNaN(customerId)) {
      return res.status(400).json({ error: "ID de cliente inválido." });
    }

    const { amount, date, description } = req.body || {};
    const monto = toNumber(amount);

    if (!(monto > 0)) {
      return res.status(400).json({ error: "Monto de deuda inválido." });
    }

    const movimiento = await prisma.customerMovement.create({
      data: {
        customerId,
        type: "DEBIT",
        method: "EFECTIVO", // o null si tu enum lo permite
        amount: monto,
        date: date ? new Date(date) : new Date(),
        description: description || "Deuda registrada",
      },
    });

    res.status(201).json(movimiento);
  } catch (err) {
    next(err);
  }
});

// POST /api/clientes-cc/:id/pago
// Registra un pago, puede tener efectivo y/o transferencia
router.post("/:id/pago", async (req, res, next) => {
  try {
    const customerId = Number(req.params.id);
    if (!customerId || Number.isNaN(customerId)) {
      return res.status(400).json({ error: "ID de cliente inválido." });
    }

    const { efectivo, transferencia, date, description } = req.body || {};
    const ef = toNumber(efectivo);
    const tr = toNumber(transferencia);

    if (!(ef > 0) && !(tr > 0)) {
      return res
        .status(400)
        .json({ error: "Ingresá al menos un monto en efectivo o transferencia." });
    }

    const movimientosCreados = [];

    if (ef > 0) {
      const movEf = await prisma.customerMovement.create({
        data: {
          customerId,
          type: "CREDIT",
          method: "EFECTIVO",
          amount: ef,
          date: date ? new Date(date) : new Date(),
          description:
            description || "Pago a cuenta de la deuda del cliente (efectivo)",
        },
      });
      movimientosCreados.push(movEf);
    }

    if (tr > 0) {
      const movTr = await prisma.customerMovement.create({
        data: {
          customerId,
          type: "CREDIT",
          method: "TRANSFERENCIA",
          amount: tr,
          date: date ? new Date(date) : new Date(),
          description:
            description || "Pago a cuenta de la deuda del cliente (transferencia)",
        },
      });
      movimientosCreados.push(movTr);
    }

    res.status(201).json(movimientosCreados);
  } catch (err) {
    next(err);
  }
});

// PUT /api/clientes-cc/movimientos/:id
// Edita un movimiento existente (deuda o pago)
router.put("/movimientos/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ error: "ID de movimiento inválido." });
    }

    const movimiento = await prisma.customerMovement.findUnique({
      where: { id },
    });

    if (!movimiento) {
      return res.status(404).json({ error: "Movimiento no encontrado." });
    }

    const { amount, efectivo, transferencia, date, description } = req.body || {};

    let dataToUpdate = {
      date: date ? new Date(date) : movimiento.date,
      description: description ?? movimiento.description,
    };

    if (movimiento.type === "DEBIT") {
      // Editar deuda
      const monto = toNumber(amount);
      if (!(monto > 0)) {
        return res.status(400).json({ error: "Monto de deuda inválido." });
      }
      dataToUpdate.amount = monto;
    } else if (movimiento.type === "CREDIT") {
      // Editar pago: usamos el método original para decidir qué campo tomar
      const ef = toNumber(efectivo);
      const tr = toNumber(transferencia);

      let nuevoMonto;
      if (movimiento.method === "TRANSFERENCIA") {
        nuevoMonto = tr;
      } else {
        nuevoMonto = ef;
      }

      if (!(nuevoMonto > 0)) {
        return res
          .status(400)
          .json({ error: "El monto del pago debe ser mayor a cero." });
      }

      dataToUpdate.amount = nuevoMonto;
    }

    const updated = await prisma.customerMovement.update({
      where: { id },
      data: dataToUpdate,
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/clientes-cc/movimientos/:id
// Elimina un movimiento
router.delete("/movimientos/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ error: "ID de movimiento inválido." });
    }

    await prisma.customerMovement.delete({
      where: { id },
    });

    res.json({ ok: true, message: "Movimiento eliminado correctamente." });
  } catch (err) {
    if (err.code === "P2025") {
      return res.status(404).json({ error: "Movimiento no encontrado." });
    }
    next(err);
  }
});

export default router;
