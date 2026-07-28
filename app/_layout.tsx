import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import * as SplashScreen from 'expo-splash-screen'
import { QuotaExhaustedModal } from '../components/QuotaExhaustedModal'
import { AuthProvider, useAuth } from '../lib/AuthContext'
import { LocationProvider } from '../lib/LocationContext'
import { LugeProvider } from '../lib/LugeContext'
import { QuotaProvider } from '../lib/QuotaContext'
import { ProactiveGuideProvider } from '../lib/ProactiveGuideContext'
import { TtsVoiceProvider } from '../lib/TtsVoiceContext'
import { colors } from '../lib/theme'

SplashScreen.preventAutoHideAsync().catch(() => {})

function RootNavigator() {
  const { loading } = useAuth()

  useEffect(() => {
    if (!loading) SplashScreen.hideAsync().catch(() => {})
  }, [loading])

  if (loading) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator size="large" color={colors.accent} />
        <StatusBar style="light" />
      </View>
    )
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="pay" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="footprint/[id]" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen
          name="proactive-guide-map"
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen name="rtc-spike" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen
          name="advanced-settings"
          options={{ animation: 'slide_from_right' }}
        />
      </Stack>
    </>
  )
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <QuotaProvider>
        <ProactiveGuideProvider>
          <TtsVoiceProvider>
            <LocationProvider>
              <LugeProvider>
                <RootNavigator />
                <QuotaExhaustedModal />
              </LugeProvider>
            </LocationProvider>
          </TtsVoiceProvider>
        </ProactiveGuideProvider>
      </QuotaProvider>
    </AuthProvider>
  )
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    backgroundColor: colors.radarBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
