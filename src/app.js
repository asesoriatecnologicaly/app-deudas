import http from 'http';
import { execSync } from 'child_process';

const PORT = process.env.PORT || 4000;

process.on('uncaughtException', (err) => {
    console.error('CRASH UNCAUGHT:', err);
    try {
        http.createServer((req, res) => {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end("UNCAUGHT EXCEPTION: " + err.message + "\n" + err.stack);
        }).listen(PORT, () => {
            console.log(`Fallback server listening on port ${PORT} after uncaught exception`);
        });
    } catch (e) {}
});

(async () => {
    try {
        console.log('Attempting to generate Prisma Client in production environment...');
        // Intentar generar Prisma explícitamente porque Hostinger Node App a menudo no ejecuta postinstall
        execSync('npx prisma generate', { stdio: 'inherit' });
        
        console.log('Prisma generated successfully (or was already there).');
        
        // Cargar el servidor original de forma dinámica para que los imports o dependencias faltones
        // no crashean el proceso principal (Top-level imports).
        await import('./app_original.js');
        console.log('Original Application started.');

    } catch (err) {
        console.error('FAILED TO START OR IN PRISMA:', err);
        const server = http.createServer((req, res) => {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end("CRASH LAUNCHING APP:\n" + err.message + "\n\n" + (err.stack || ""));
        });
        
        server.listen(PORT, () => {
            console.log(`Fallback crash server listening on port ${PORT}`);
        });
    }
})();
