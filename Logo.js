import React from "react";
import { View, Text, StyleSheet } from "react-native";

// Storefront logo built from plain views (no image files needed)
export default function Logo({ size = 120 }) {
  const s = size / 120;
  const stripes = ["#F59E0B", "#FFFFFF", "#F59E0B", "#FFFFFF", "#F59E0B"];
  return (
    <View style={{ width: size, height: size, alignItems: "center" }}>
      <View style={[st.awning, { width: 110 * s, height: 34 * s, borderRadius: 8 * s }]}>
        {stripes.map((c, i) => (
          <View key={i} style={{ flex: 1, backgroundColor: c }} />
        ))}
      </View>
      <View style={[st.body, { width: 96 * s, height: 70 * s, borderBottomLeftRadius: 14 * s, borderBottomRightRadius: 14 * s }]}>
        <Text style={{ fontSize: 34 * s, fontWeight: "900", color: "#0F766E" }}>M</Text>
        <View style={[st.door, { width: 22 * s, height: 26 * s }]} />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  awning: { flexDirection: "row", overflow: "hidden", elevation: 4 },
  body: { backgroundColor: "#fff", alignItems: "center", justifyContent: "center", marginTop: 2 },
  door: { position: "absolute", bottom: 0, right: 10, backgroundColor: "#F59E0B", borderTopLeftRadius: 6, borderTopRightRadius: 6, opacity: 0.9 },
});
