// frontend/src/shared/hooks/useRiderSocketDispatch.ts
import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

interface OrderPingPayload {
  deliveryId: string;
  restaurantName: string;
  timeoutSeconds: number;
  distanceKm: number;
  timestamp: number;
}

interface UseRiderSocketOptions {
  riderId: number;
  isOnline: boolean;
  vehicleType?: string;
  activeDeliveryId?: string | null;
}

function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function useRiderSocketDispatch({
  riderId,
  isOnline,
  vehicleType = 'motorcycle',
  activeDeliveryId = null,
}: UseRiderSocketOptions) {
  const socketRef = useRef<Socket | null>(null);
  const [currentPing, setCurrentPing] = useState<OrderPingPayload | null>(null);
  const [pingTimeLeft, setPingTimeLeft] = useState<number>(0);
  const lastSentCoords = useRef<{ lat: number; lng: number } | null>(null);

  // Initialize Socket connection
  useEffect(() => {
    const socket = io('http://localhost:3001');
    socketRef.current = socket;

    socket.on('order_received_ping', (payload: OrderPingPayload) => {
      setCurrentPing(payload);
      setPingTimeLeft(payload.timeoutSeconds || 30);
    });

    socket.on('order_ping_result', (result: { success: boolean; message: string }) => {
      if (result.success) {
        setCurrentPing(null);
      } else {
        alert(result.message || 'Dispatch ping expired.');
        setCurrentPing(null);
      }
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Register online state (driver_go_online)
  useEffect(() => {
    if (!socketRef.current || !isOnline) return;

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => {
        const { latitude, longitude } = pos.coords;
        socketRef.current?.emit('driver_go_online', {
          riderId,
          currentLat: latitude,
          currentLng: longitude,
          vehicleType,
        });
      });
    }
  }, [riderId, isOnline, vehicleType]);

  // Ping Countdown Timer
  useEffect(() => {
    if (pingTimeLeft <= 0 || !currentPing) return;

    const timer = setInterval(() => {
      setPingTimeLeft((prev) => {
        if (prev <= 1) {
          setCurrentPing(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [pingTimeLeft, currentPing]);

  // Accept Order Action
  const acceptOrder = useCallback(() => {
    if (!currentPing || !socketRef.current) return;

    socketRef.current.emit('driver_accept_order', {
      deliveryId: currentPing.deliveryId,
      riderId,
    });
  }, [currentPing, riderId]);

  // Decline Order Action
  const declineOrder = useCallback(() => {
    setCurrentPing(null);
  }, []);

  // Phase E: Stream Telemetry (rider_location_update with 5-meter Smart Filter)
  useEffect(() => {
    if (!isOnline || !navigator.geolocation) return;

    const intervalMs = activeDeliveryId ? 5000 : 180000;

    const interval = setInterval(() => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude: lat, longitude: lng, heading, speed } = pos.coords;

          if (lastSentCoords.current) {
            const movedMeters = calculateDistanceMeters(
              lastSentCoords.current.lat,
              lastSentCoords.current.lng,
              lat,
              lng
            );

            // Skip packet if rider moved less than 5 meters
            if (movedMeters < 5 && activeDeliveryId) {
              return;
            }
          }

          lastSentCoords.current = { lat, lng };

          socketRef.current?.emit('rider_location_update', {
            deliveryId: activeDeliveryId,
            riderId,
            lat,
            lng,
            heading: heading || 0,
            speed: speed || 0,
          });
        },
        (err) => console.warn('GPS Error:', err),
        { enableHighAccuracy: true }
      );
    }, intervalMs);

    return () => clearInterval(interval);
  }, [isOnline, riderId, activeDeliveryId]);

  return {
    currentPing,
    pingTimeLeft,
    acceptOrder,
    declineOrder,
  };
}
