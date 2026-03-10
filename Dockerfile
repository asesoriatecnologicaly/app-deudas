FROM node:18

WORKDIR /app

# 1) Copiar dependencias
COPY package.json package-lock.json* ./

# 2) Instalar dependencias
RUN npm install

# 3) Copiar codigo del backend
COPY prisma ./prisma
COPY src ./src

# 4) Generar Prisma Client
RUN npx prisma generate

# 5) Variables y puerto
ENV PORT=4000
EXPOSE 4000

# 6) Comando de inicio
CMD ["npm", "start"]
