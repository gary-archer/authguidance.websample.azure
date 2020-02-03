import {NextFunction, Request, Response} from 'express';
import {ClientError} from '../../logic/errors/clientError';
import {ErrorCodes} from '../../logic/errors/errorCodes';
import {CompanyRepository} from '../../logic/repositories/companyRepository';
import {CompanyService} from '../../logic/services/companyService';
import {UserInfoService} from '../../logic/services/userInfoService';
import {JsonFileReader} from '../../logic/utilities/jsonFileReader';
import {SampleCustomClaimsProvider} from '../authorization/sampleCustomClaimsProvider';
import {Configuration} from '../configuration/configuration';
import {ErrorHandler} from '../errors/errorHandler';
import {Authenticator} from '../oauth/authenticator';
import {Authorizer} from '../oauth/authorizer';
import {ClaimsCache} from '../oauth/claimsCache';
import {IssuerMetadata} from '../oauth/issuerMetadata';
import {ResponseWriter} from '../utilities/responseWriter';

/*
 * A class to route API requests to business logic classes
 */
export class Router {

    private _apiConfig: Configuration;
    private _claimsCache: ClaimsCache;
    private _issuerMetadata: IssuerMetadata;

    public constructor(apiConfig: Configuration) {
        this._apiConfig = apiConfig;
        this._claimsCache = new ClaimsCache(this._apiConfig.oauth);
        this._issuerMetadata = new IssuerMetadata(this._apiConfig.oauth);
        this._setupCallbacks();
    }

    /*
     * Load metadata once at application startup
     */
    public async initialize(): Promise<void> {
        await this._issuerMetadata.load();
    }

    /*
     * The entry point for authorization and claims handling
     */
    public async authorizationHandler(
        request: Request,
        response: Response,
        next: NextFunction): Promise<void> {

        // Create authorization related classes on every API request
        const authenticator = new Authenticator(this._apiConfig.oauth, this._issuerMetadata.issuer);
        const customClaimsProvider = new SampleCustomClaimsProvider();
        const authorizer = new Authorizer(this._claimsCache, authenticator, customClaimsProvider);

        // Call the authorizer to do the work
        const claims = await authorizer.authorizeRequestAndGetClaims(request);

        // On success, set claims against the request context and move on to the controller logic
        response.locals.claims = claims;
        next();
    }

    /*
     * Return the user info claims from authorization
     */
    public getUserClaims(request: Request, response: Response, next: NextFunction): void {

        const service = new UserInfoService(response.locals.claims);
        const claims = service.getUserClaims();
        ResponseWriter.writeObjectResponse(response, 200, claims);
    }

    /*
     * Return a list of companies
     */
    public async getCompanyList(request: Request, response: Response, next: NextFunction): Promise<void> {

        // Create the controller instance and its dependencies on every API request
        const reader = new JsonFileReader();
        const repository = new CompanyRepository(reader);
        const service = new CompanyService(repository, response.locals.claims);

        // Get the data and return it in the response
        const result = await service.getCompanyList();
        ResponseWriter.writeObjectResponse(response, 200, result);
    }

    /*
     * Return company transactions
     */
    public async getCompanyTransactions(request: Request, response: Response, next: NextFunction): Promise<void> {

        // Create the controller instance and its dependencies on every API request
        const reader = new JsonFileReader();
        const repository = new CompanyRepository(reader);
        const service = new CompanyService(repository, response.locals.claims);

        // Get the supplied id as a number, and return 400 if invalid input was received
        const id = parseInt(request.params.id, 10);
        if (isNaN(id) || id <= 0) {
            throw new ClientError(
                400,
                ErrorCodes.invalidCompanyId,
                'The company id must be a positive numeric integer');
        }

        const result = await service.getCompanyTransactions(id);
        ResponseWriter.writeObjectResponse(response, 200, result);
    }

    /*
     * The entry point for handling exceptions forwards all exceptions to our handler class
     */
    public unhandledExceptionHandler(unhandledException: any, request: Request, response: Response): void {

        const clientError = ErrorHandler.handleError(unhandledException);
        ResponseWriter.writeObjectResponse(response, clientError.statusCode, clientError.toResponseFormat());
    }

    /*
     * Set up async callbacks
     */
    private _setupCallbacks(): void {
        this.authorizationHandler = this.authorizationHandler.bind(this);
        this.getUserClaims = this.getUserClaims.bind(this);
        this.getCompanyList = this.getCompanyList.bind(this);
        this.getCompanyTransactions = this.getCompanyTransactions.bind(this);
        this.unhandledExceptionHandler = this.unhandledExceptionHandler.bind(this);
    }
}
