import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { tokens } from '../tokens';

export const Button = ({ title, onPress }: { title: string; onPress: () => void }) => (
    <TouchableOpacity style={styles.button} onPress={onPress}>
        <Text style={styles.text}>{title}</Text>
    </TouchableOpacity>
);

const styles = StyleSheet.create({
    button: {
        backgroundColor: tokens.colors.primary,
        padding: tokens.spacing.md,
        borderRadius: tokens.borderRadius.md,
        alignItems: 'center',
    },
    text: {
        color: tokens.colors.text.inverse,
        fontWeight: 'bold',
    },
});
