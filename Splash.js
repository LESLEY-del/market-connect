import React, { useEffect, useRef } from "react";
import { View, Text, Animated, Easing, StyleSheet } from "react-native";
import Logo from "./Logo";

export default function Splash() {
  const pop = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const bar = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(pop, { toValue: 1, friction: 5, useNativeDriver: true }).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();
    Animated.loop(
      Animated.timing(bar, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.ease), useNativeDriver: true })
    ).start();
  }, []);

  const scale = Animated.multiply(pop, pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }));
  const slide = bar.interpolate({ inputRange: [0, 1], outputRange: [-120, 220] });

  return (
    <View style={st.wrap}>
      <Animated.View style={{ opacity: pop, transform: [{ scale }] }}>
        <View style={st.circle}><Logo size={120} /></View>
      </Animated.View>
      <Animated.View style={{ opacity: pop, alignItems: "center" }}>
        <Text style={st.name}>Market Rental Place</Text>
        <Text style={st.tag}>Every store. One place.</Text>
      </Animated.View>
      <View style={st.track}>
        <Animated.View style={[st.fill, { transform: [{ translateX: slide }] }]} />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#0F766E", alignItems: "center", justifyContent: "center" },
  circle: { width: 190, height: 190, borderRadius: 95, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center", marginBottom: 28 },
  name: { color: "#fff", fontSize: 28, fontWeight: "800", letterSpacing: 0.5 },
  tag: { color: "#CCFBF1", fontSize: 15, marginTop: 6 },
  track: { width: 120, height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.25)", overflow: "hidden", marginTop: 40 },
  fill: { width: 60, height: 5, borderRadius: 3, backgroundColor: "#F59E0B" },
});
