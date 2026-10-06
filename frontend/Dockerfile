FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_API_URL=/api
ARG VITE_API_ORIGIN=https://tracktour.com
ARG VITE_SOCKET_URL=https://tracktour.com
ARG VITE_PAYMONGO_PUBLIC_KEY
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_API_ORIGIN=${VITE_API_ORIGIN}
ENV VITE_SOCKET_URL=${VITE_SOCKET_URL}
ENV VITE_PAYMONGO_PUBLIC_KEY=${VITE_PAYMONGO_PUBLIC_KEY}

RUN npm run build

FROM nginx:alpine AS runtime

COPY nginx.vps.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
