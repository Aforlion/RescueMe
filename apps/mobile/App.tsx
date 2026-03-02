import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Text, SafeAreaView } from 'react-native';
import SOSScreen from './src/screens/SOSScreen';
import PaloScreen from './src/screens/PaloScreen';
import WalletScreen from './src/screens/WalletScreen';

export default function App() {
  const [activeTab, setActiveTab] = useState<'SOS' | 'PALO' | 'WALLET'>('SOS');

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {activeTab === 'SOS' ? <SOSScreen /> :
          activeTab === 'PALO' ? <PaloScreen /> : <WalletScreen />}
      </View>

      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'SOS' && styles.activeTab]}
          onPress={() => setActiveTab('SOS')}
        >
          <Text style={[styles.tabText, activeTab === 'SOS' && styles.activeTabText]}>RESCUE</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === 'PALO' && styles.activeTab]}
          onPress={() => setActiveTab('PALO')}
        >
          <Text style={[styles.tabText, activeTab === 'PALO' && styles.activeTabText]}>PALO</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === 'WALLET' && styles.activeTab]}
          onPress={() => setActiveTab('WALLET')}
        >
          <Text style={[styles.tabText, activeTab === 'WALLET' && styles.activeTabText]}>WALLET</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}


const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    flex: 1,
  },
  tabBar: {
    flexDirection: 'row',
    height: 60,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeTab: {
    borderTopWidth: 2,
    borderTopColor: '#ff4d4f',
  },
  tabText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8c8c8c',
  },
  activeTabText: {
    color: '#ff4d4f',
  },
});
