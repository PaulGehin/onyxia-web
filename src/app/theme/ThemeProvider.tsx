
import { useState } from "react";
import ScopedCssBaseline from '@material-ui/core/ScopedCssBaseline';
import { ThemeProvider as MuiThemeProvider, StylesProvider } from "@material-ui/core/styles";
import memoize from "memoizee";
import { createTheme } from "./theme";

export function themeProviderFactory(
    params: {
        isReactStrictModeEnabled: boolean;
    }
) {

    const { isReactStrictModeEnabled } = params;

    function ThemeProvider(
        props: {
            isDarkModeEnabled: boolean;
            children: React.ReactNode;
        }
    ) {

        const {
            isDarkModeEnabled,
            children
        } = props;

        const { theme } = useState(
            () => memoize(
                (isDarkModeEnabled: boolean) =>
                    createTheme({
                        isReactStrictModeEnabled,
                        isDarkModeEnabled
                    })
            )
        )[0](isDarkModeEnabled);

        return (
            <MuiThemeProvider theme={theme}>
                <ScopedCssBaseline>
                    <StylesProvider injectFirst>
                        {children}
                    </StylesProvider>
                </ScopedCssBaseline>
            </MuiThemeProvider>
        );


    }

    return { ThemeProvider };

}

