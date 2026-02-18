import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';

export const Button = ({ title, onPress }: { title: string; onPress: () => void }) => (
    <TouchableOpacity style={styles.button} onPress={onPress}>
        <Text style={styles.text}>{title}</Text>
    </TouchableOpacity>
);

const styles = StyleSheet.create({
    button: {
        backgroundColor: '#0070f3',
        padding: 16,
        borderRadius: 8,
        alignItems: 'center',
    },
    text: {
        color: '#fff',
        fontWeight: 'bold',
    },
});
