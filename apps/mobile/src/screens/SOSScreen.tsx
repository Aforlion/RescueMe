import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Alert, Dimensions, Text, TouchableOpacity } from 'react-native';
import * as Location from 'expo-location';
import { supabase } from '@rescueme/supabase';
import { Button, tokens } from '@rescueme/ui';

const { width } = Dimensions.get('window');

export default function SOSScreen() {
    const [loading, setLoading] = useState(false);
    const [countdown, setCountdown] = useState<number | null>(null);
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, []);

    const startSOSProcess = () => {
        if (loading || countdown !== null) return;
        setCountdown(5);

        timerRef.current = setInterval(() => {
            setCountdown(prev => {
                if (prev === null) return null;
                if (prev <= 1) {
                    if (timerRef.current) clearInterval(timerRef.current);
                    executeSOS();
                    return null;
                }
                return prev - 1;
            });
        }, 1000);
    };

    const cancelSOS = () => {
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        setCountdown(null);
        Alert.alert('SOS Cancelled', 'Signal was not sent.');
    };

    const executeSOS = async () => {
        setLoading(true);
        try {
            // 1. Request Permission
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                throw new Error('Permission to access location was denied');
            }

            // 2. Get Location
            const location = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.High,
            });

            const point = `POINT(${location.coords.longitude} ${location.coords.latitude})`;

            // 3. Submit to Supabase
            const { error } = await supabase
                .from('incidents')
                .insert({
                    type: 'MEDICAL',
                    location: point,
                    description: 'SOS Triggered from Mobile App (Real-time)',
                    status: 'PENDING',
                    latitude: location.coords.latitude,
                    longitude: location.coords.longitude,
                });

            if (error) throw error;

            Alert.alert('RESCUE REQUESTED', 'Guides in your area have been notified. Stay calm.');
        } catch (error: any) {
            Alert.alert('SOS Failed', error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <View style={styles.container}>
            <Text style={styles.title}>EMERGENCY</Text>

            <View style={styles.panicContainer}>
                {countdown !== null ? (
                    <TouchableOpacity style={styles.countdownBox} onPress={cancelSOS}>
                        <Text style={styles.countdownNumber}>{countdown}</Text>
                        <Text style={styles.cancelText}>TAP TO CANCEL</Text>
                    </TouchableOpacity>
                ) : (
                    <Button
                        title={loading ? "REQUESTING..." : "PANIC SOS"}
                        onPress={startSOSProcess}
                    />
                )}
            </View>

            <Text style={styles.footer}>One-tap assistance for Nigeria</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
        alignItems: 'center',
        justifyContent: 'center',
        padding: tokens.spacing.lg,
    },
    title: {
        fontSize: 32,
        fontWeight: '900',
        color: tokens.colors.primary,
        marginBottom: 40,
        letterSpacing: 2,
    },
    panicContainer: {
        width: width * 0.8,
        height: 120,
        justifyContent: 'center',
    },
    countdownBox: {
        backgroundColor: tokens.colors.primary,
        borderRadius: tokens.borderRadius.lg,
        padding: tokens.spacing.lg,
        alignItems: 'center',
        shadowColor: tokens.colors.primary,
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.3,
        shadowRadius: 20,
        elevation: 10,
    },
    countdownNumber: {
        fontSize: 48,
        fontWeight: '900',
        color: '#fff',
    },
    cancelText: {
        fontSize: 12,
        fontWeight: 'bold',
        color: '#fff',
        marginTop: 4,
        opacity: 0.8,
    },
    footer: {
        marginTop: 40,
        color: tokens.colors.text.secondary,
        fontSize: 12,
        textTransform: 'uppercase',
        fontWeight: 'bold',
    },
});

