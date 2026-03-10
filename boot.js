import http from 'http';

const PORT = process.env.PORT || 4000;

process.on('uncaughtException', (err) => {
    console.error('CRASH UNCAUGHT:', err);
    http.createServer((req, res) => {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end("UNCAUGHT EXCEPTION: " + err.message + "\n" + err.stack);
    }).listen(PORT, () => {
        console.log(`Fallback server listening on port ${PORT} after uncaught exception`);
    });
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('UNHANDLED REJECTION:', reason);
    // Optionally we could start a server here too if we think it's fatal
});

(async () => {
    try {
        console.log('Attempting to start application...');
        await import('./src/app.js');
        console.log('Application started successfully.');
    } catch (err) {
        console.error('FAILED TO IMPORT APP.JS', err);
        const server = http.createServer((req, res) => {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end("CRASH LAUNCHING APP: " + err.message + "\n" + err.stack);
        });
        
        server.listen(PORT, () => {
            console.log(`Fallback crash server listening on port ${PORT}`);
        });
    }
})();
