import React, { useState } from 'react';
import { View, StyleSheet, Alert, Dimensions, Text } from 'react-native';
import { supabase } from '../lib/supabase';
import { Button } from '@rescueme/ui';

const { width } = Dimensions.get('window');

export default function SOSScreen() {
    const [loading, setLoading] = useState(false);

    const triggerSOS = async () => {
        setLoading(true);
        try {
            const mockLocation = 'POINT(3.3792 6.5244)'; // Lagos, Nigeria

            const { error } = await supabase
                .from('incidents')
                .insert({
                    type: 'MEDICAL',
                    location: mockLocation,
                    description: 'SOS Triggered from Mobile App',
                    priority_score: 5,
                });

            if (error) throw error;

            Alert.alert('RESCUE REQUESTED', 'Guides in your area have been notified. Stay calm.');
        } catch (error: any) {
            Alert.alert('Error', error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <View style={styles.container}>
            <Text style={styles.title}>EMERGENCY</Text>
            <View style={styles.panicContainer}>
                <Button
                    title={loading ? "REQUESTING..." : "PANIC SOS"}
                    onPress={triggerSOS}
                />
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
    },
    title: {
        fontSize: 32,
        fontWeight: '900',
        color: '#ff4d4f',
        marginBottom: 40,
        letterSpacing: 2,
    },
    panicContainer: {
        width: width * 0.8,
    },
    footer: {
        marginTop: 40,
        color: '#8c8c8c',
        fontSize: 12,
        textTransform: 'uppercase',
    },
});
