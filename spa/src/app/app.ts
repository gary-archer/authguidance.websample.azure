import $ from 'jquery';
import {ApiClient} from '../api/client/apiClient';
import {Configuration} from '../configuration/configuration';
import {ConfigurationLoader} from '../configuration/configurationLoader';
import {ErrorConsoleReporter} from '../plumbing/errors/errorConsoleReporter';
import {Authenticator} from '../plumbing/oauth/authenticator';
import {TraceListener} from '../plumbing/oauth/trace/traceListener';
import {ErrorView} from '../views/errorView';
import {HeaderButtonsView} from '../views/headerButtonsView';
import {Router} from '../views/router';
import {TitleView} from '../views/titleView';
import {TraceView} from '../views/traceView';

/*
 * The application class
 */
export class App {

    // Global objects
    private _configuration?: Configuration;
    private _authenticator?: Authenticator;
    private _apiClient?: ApiClient;
    private _router?: Router;
    private _traceListener?: TraceListener;

    // Child views
    private _titleView?: TitleView;
    private _headerButtonsView?: HeaderButtonsView;
    private _errorView?: ErrorView;
    private _traceView?: TraceView;

    // State flags
    private _isInitialised: boolean;
    private _mainViewLoaded: boolean;
    private _userInfoLoaded: boolean;

    /*
     * Initialise state
     */
    public constructor() {

        // Configure the JQuery namespace
        (window as any).$ = $;

        // Initialise state flags
        this._isInitialised = false;
        this._mainViewLoaded = false;
        this._userInfoLoaded = false;
        this._setupCallbacks();
    }

    /*
     * The entry point for the SPA
     */
    public async execute(): Promise<void> {

        try {
            // Start listening for hash changes
            window.onhashchange = this._onHashChange;

            // Do the initial render
            this._initialRender();

            // Do one time app initialisation
            await this._initialiseApp();

            // We must be prepared for page invocation to be an OAuth login response
            await this._handleLoginResponse();

            // Load the main view, which may trigger a login redirect
            await this._loadMainView();

            // Also load user info unless we are logged out
            if (location.hash.indexOf('loggedout') === -1) {
                await this._loadUserInfo();
            }

        } catch (e) {

            // Report failures
            this._errorView?.report(e);
        }
    }

    /*
     * Render views in their initial state
     */
    private _initialRender() {

        this._titleView = new TitleView();
        this._titleView.load();

        this._headerButtonsView = new HeaderButtonsView(
            this._onHome,
            this._onReloadData,
            this._onExpireAccessToken,
            this._onExpireRefreshToken,
            this._onLogout);
        this._headerButtonsView.load();

        this._errorView = new ErrorView();
        this._errorView.load();

        this._traceView = new TraceView();
        this._traceView.load();
    }

    /*
     * Initialise the app
     */
    private async _initialiseApp(): Promise<void> {

        // Download application configuration
        this._configuration = await ConfigurationLoader.download('spa.config.json');

        // Initialise our OIDC Client wrapper
        this._authenticator = new Authenticator(this._configuration.oauth);
        this._traceListener = new TraceListener();

        // Create a client to reliably call the API
        this._apiClient = new ApiClient(this._configuration.app.apiBaseUrl, this._authenticator);

        // Our simple router passes the OIDC Client instance between views
        this._router = new Router(this._apiClient, this._errorView!);

        // Update state to indicate that global objects are loaded
        this._isInitialised = true;
    }

    /*
     * Handle login responses on page load so that we have tokens and can call APIs
     */
    private async _handleLoginResponse(): Promise<void> {

        await this._authenticator!.handleLoginResponse();
    }

    /*
     * Load API data for the main view and update UI controls
     */
    private async _loadMainView(): Promise<void> {

        try {

            // Call the API
            this._headerButtonsView!.disableSessionButtons();
            await this._router!.loadView();

            // Enable session buttons if all view have loaded
            if (this._userInfoLoaded) {
                this._headerButtonsView!.enableSessionButtons();
            }

            // Update state
            this._mainViewLoaded = true;

        } catch (e) {

            // Update state and rethrow
            this._mainViewLoaded = false;
            throw e;
        }
    }

    /*
     * Load API data for the user info fragment
     */
    private async _loadUserInfo(): Promise<void> {

        try {

            // Call the API
            this._headerButtonsView!.disableSessionButtons();
            await this._titleView!.loadUserInfo(this._apiClient!);

            // Enable session buttons if all views have loaded
            if (this._mainViewLoaded) {
                this._headerButtonsView!.enableSessionButtons();
            }

            // Update state
            this._userInfoLoaded = true;

        } catch (e) {

            // Update state and rethrow
            this._userInfoLoaded = false;
            throw e;
        }
    }

    /*
     * Change the view based on the hash URL and catch errors
     */
    private async _onHashChange(): Promise<void> {

        // Handle updates to log levels when the URL log setting is changed
        this._traceListener!.updateLogLevelIfRequired();

        try {

            // Run main view navigation
            if (this._isInitialised) {
                await this._loadMainView();
            }

        } catch (e) {

            // Report failures
            this._errorView!.report(e);
        }
    }

    /*
     * The home button moves to the home view but also deals with error recovery
     */
    private async _onHome(): Promise<void> {

        try {

            // If we have not initialised, re-initialise the app
            if (!this._isInitialised) {
                await this._initialiseApp();
            }

            if (this._isInitialised) {

                // Move to the home view
                location.hash = '#';

                // Load data when home is clicked, which will retry if there were previous load errors
                if (!this._mainViewLoaded) {
                    await this._loadMainView();
                }
                if (!this._userInfoLoaded) {
                    await this._loadUserInfo();
                }
            }

        } catch (e) {
            this._errorView!.report(e);
        }
    }

    /*
     * Try to reload data when requested via the button click
     */
    private async _onReloadData(): Promise<void> {

        try {
            await this._loadMainView();
            await this._loadUserInfo();

        } catch (e) {

            this._errorView!.report(e);
        }
    }

    /*
     * Start a logout request
     */
    private async _onLogout(): Promise<void> {

        try {

           // Start the logout redirect
           await this._authenticator!.startLogout();

        } catch (e) {

            // On error, only output logout errors to the console
            ErrorConsoleReporter.output(e);

            // Force a move to the login required view
            location.hash = '#/loggedout';
        }
    }

    /*
     * Force the access token to return 401
     */
    private async _onExpireAccessToken(): Promise<void> {
        await this._authenticator!.expireAccessToken();
    }

    /*
     * Force the refresh token to return 401
     */
    private async _onExpireRefreshToken(): Promise<void> {
        await this._authenticator!.expireRefreshToken();
    }

    /*
     * Plumbing to ensure that the this parameter is available in async callbacks
     */
    private _setupCallbacks(): void {
        this._onHashChange = this._onHashChange.bind(this);
        this._onHome = this._onHome.bind(this);
        this._onLogout = this._onLogout.bind(this);
        this._onReloadData = this._onReloadData.bind(this);
        this._onExpireAccessToken = this._onExpireAccessToken.bind(this);
        this._onExpireRefreshToken = this._onExpireRefreshToken.bind(this);
   }
}
