// frontend/src/shared/hooks/useMerchantSocketNotifier.ts
import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

export function useMerchantSocketNotifier() {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io('http://localhost:3001');
    socketRef.current = socket;

    return () => {
      socket.disconnect();
    };
  }, []);

  // Endpoint 2: Merchant Dispatch Signal (restaurant_accepted_order)
  const notifyOrderAccepted = useCallback((params: {
    deliveryId: string;
    restaurantName: string;
    restaurantLat: number;
    restaurantLng: number;
    radiusKm?: number;
    timeoutSeconds?: number;
  }) => {
    if (!socketRef.current) return;

    socketRef.current.emit('restaurant_accepted_order', {
      deliveryId: params.deliveryId,
      restaurantName: params.restaurantName,
      restaurantLat: params.restaurantLat,
      restaurantLng: params.restaurantLng,
      radiusKm: params.radiusKm || 5.0,
      timeoutSeconds: params.timeoutSeconds || 30,
    });
  }, []);

  return { notifyOrderAccepted };
}
