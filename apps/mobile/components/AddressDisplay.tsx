import { View } from "react-native";
import { shortenAddress, type Hex } from "@minerva/core";
import { Text } from "./Text";

interface Props {
  address: Hex;
  full?: boolean;
}

/** Source: Minerva Network — JetBrains Mono in mv-bone. */
export function AddressDisplay({ address, full = false }: Props) {
  return (
    <View>
      <Text variant="mono" weight="medium">
        {full ? address : shortenAddress(address)}
      </Text>
    </View>
  );
}
