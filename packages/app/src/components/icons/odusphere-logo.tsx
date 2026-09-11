import { useMemo } from "react";
import { Image } from "react-native";

interface OdusphereLogoProps {
  size?: number;
  color?: string;
}

export function OdusphereLogo({ size = 64 }: OdusphereLogoProps) {
  const imageStyle = useMemo(() => ({ width: size, height: size }), [size]);

  return (
    <Image
      source={require("../../../assets/images/brand-mark.png")}
      style={imageStyle}
      resizeMode="contain"
    />
  );
}
