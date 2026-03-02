import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Text, FlatList, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { supabase } from '@rescueme/supabase';
import type { Transaction, Profile } from '@rescueme/types';
import { tokens } from '@rescueme/ui';

export default function WalletScreen() {
    const [profile, setProfile] = useState<Profile | null>(null);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchWalletData();
    }, []);

    const fetchWalletData = async () => {
        setLoading(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            // 1. Fetch Profile for Balance
            const { data: profileData, error: profileError } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', user.id)
                .single();

            if (profileError) throw profileError;
            setProfile(profileData);

            // 2. Fetch Transactions
            const { data: transData, error: transError } = await supabase
                .from('transactions')
                .select('*')
                .order('created_at', { ascending: false });

            if (transError) throw transError;
            setTransactions(transData || []);
        } catch (error: any) {
            console.error('Error fetching wallet data:', error.message);
        } finally {
            setLoading(false);
        }
    };

    const renderTransaction = ({ item }: { item: Transaction }) => {
        const isPositive = item.amount > 0;
        return (
            <View style={styles.transItem}>
                <View style={styles.transInfo}>
                    <Text style={styles.transTitle}>{item.description}</Text>
                    <Text style={styles.transDate}>
                        {new Date(item.created_at).toLocaleDateString()}
                    </Text>
                </View>
                <View style={[styles.amountBadge, isPositive ? styles.gainBg : styles.lossBg]}>
                    <Text style={[styles.amountText, isPositive ? styles.gainText : styles.lossText]}>
                        {isPositive ? '+' : ''}{item.amount}
                    </Text>
                </View>
            </View>
        );
    };

    return (
        <View style={styles.container}>
            <Text style={styles.header}>EQUITY LEDGER</Text>
            <Text style={styles.subHeader}>REPUTATION & SURVIVAL CREDITS</Text>

            <View style={styles.balanceCard}>
                <Text style={styles.balanceLabel}>CURRENT BALANCE</Text>
                <View style={styles.balanceRow}>
                    <Text style={styles.balanceValue}>{profile?.token_balance || 0}</Text>
                    <Text style={styles.currencySymbol}>RME</Text>
                </View>
                <View style={styles.trustBar}>
                    <View style={[styles.trustFill, { width: `${profile?.trust_score || 50}%` }]} />
                </View>
                <Text style={styles.trustLabel}>TRUST SCORE: {profile?.trust_score || 50}/100</Text>
            </View>

            <Text style={styles.sectionHeader}>TRANSACTION HISTORY</Text>

            {loading ? (
                <View style={styles.centered}>
                    <ActivityIndicator color={tokens.colors.secondary} size="large" />
                    <Text style={styles.loadingText}>SYNCING LEDGER...</Text>
                </View>
            ) : (
                <FlatList
                    data={transactions}
                    keyExtractor={(item) => item.id}
                    renderItem={renderTransaction}
                    ListEmptyComponent={
                        <View style={styles.emptyContainer}>
                            <Text style={styles.emptyText}>Ledger is indexed/empty.</Text>
                            <Text style={styles.emptyHint}>Resolve incidents or verify identity to earn credits.</Text>
                        </View>
                    }
                    contentContainerStyle={styles.listContent}
                />
            )}

            <TouchableOpacity style={styles.refreshButton} onPress={fetchWalletData}>
                <Text style={styles.refreshText}>REFRESH LEDGER</Text>
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: tokens.colors.background,
        padding: tokens.spacing.lg,
    },
    header: {
        fontSize: 32,
        fontWeight: '900',
        color: tokens.colors.text.primary,
        marginTop: 40,
        letterSpacing: -1,
    },
    subHeader: {
        fontSize: 10,
        fontWeight: '900',
        color: tokens.colors.secondary,
        marginBottom: 32,
        letterSpacing: 2,
    },
    balanceCard: {
        backgroundColor: '#1a1a1a',
        padding: tokens.spacing.xl,
        borderRadius: tokens.borderRadius.xl,
        marginBottom: 32,
        borderWidth: 1,
        borderColor: '#333',
    },
    balanceLabel: {
        fontSize: 10,
        fontWeight: '900',
        color: '#8c8c8c',
        letterSpacing: 1,
    },
    balanceRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        marginTop: 8,
    },
    balanceValue: {
        fontSize: 48,
        fontWeight: '900',
        color: '#fff',
    },
    currencySymbol: {
        fontSize: 14,
        fontWeight: '900',
        color: tokens.colors.secondary,
        marginLeft: 8,
    },
    trustBar: {
        height: 4,
        backgroundColor: '#333',
        borderRadius: 2,
        marginTop: 24,
        overflow: 'hidden',
    },
    trustFill: {
        height: '100%',
        backgroundColor: tokens.colors.secondary,
    },
    trustLabel: {
        fontSize: 10,
        fontWeight: '900',
        color: '#8c8c8c',
        marginTop: 8,
        textAlign: 'right',
    },
    sectionHeader: {
        fontSize: 12,
        fontWeight: '900',
        color: tokens.colors.text.secondary,
        marginBottom: 16,
        letterSpacing: 1,
    },
    listContent: {
        paddingBottom: 24,
    },
    transItem: {
        backgroundColor: '#fff',
        padding: tokens.spacing.md,
        borderRadius: tokens.borderRadius.lg,
        marginBottom: tokens.spacing.sm,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: tokens.colors.surface,
    },
    transInfo: {
        flex: 1,
    },
    transTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: tokens.colors.text.primary,
    },
    transDate: {
        fontSize: 10,
        color: tokens.colors.text.secondary,
        marginTop: 2,
    },
    amountBadge: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: tokens.borderRadius.sm,
    },
    gainBg: {
        backgroundColor: '#f6ffed',
    },
    lossBg: {
        backgroundColor: '#fff1f0',
    },
    amountText: {
        fontSize: 14,
        fontWeight: '900',
    },
    gainText: {
        color: tokens.colors.success,
    },
    lossText: {
        color: tokens.colors.error,
    },
    centered: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 40,
    },
    loadingText: {
        marginTop: 16,
        fontSize: 10,
        fontWeight: '900',
        color: tokens.colors.text.secondary,
        letterSpacing: 1,
    },
    emptyContainer: {
        alignItems: 'center',
        marginTop: 60,
    },
    emptyText: {
        fontSize: 14,
        fontWeight: '700',
        color: tokens.colors.text.secondary,
        fontStyle: 'italic',
    },
    emptyHint: {
        fontSize: 10,
        color: tokens.colors.text.secondary,
        marginTop: 8,
        textAlign: 'center',
    },
    refreshButton: {
        backgroundColor: 'transparent',
        padding: tokens.spacing.md,
        borderRadius: tokens.borderRadius.lg,
        alignItems: 'center',
        marginTop: tokens.spacing.md,
        borderWidth: 1,
        borderColor: tokens.colors.secondary,
    },
    refreshText: {
        color: tokens.colors.secondary,
        fontWeight: '900',
        fontSize: 12,
        letterSpacing: 1,
    },
});
