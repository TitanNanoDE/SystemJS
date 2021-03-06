import { Make } from 'application-frame/util/make';
import Log from './Log';
import Application from 'application-frame/core/Application';
import SystemHandlers from './SystemHandlers';
import UrlResolver from './UrlResolver';
import ApplicationMenuManager from './ApplicationMenuManager';
import IOThread from '../threading/IOThread';
import { ViewController, ViewControllerProxied } from './ViewController';

const IMEDIATE_INVOCE = 0;

let registeredApplications = {};
let logger = Log.use('ApplicationManager');
let instanceList = {};
let windowManagerReady = false;
const applicationSymbols = new WeakMap();

const { create } = Object;

let initApplication = function(instance, manager) {
    let init = window => {
        logger.log(`Application ${instance.name} loaded!`);

        manager.emit('applicationLaunched', Make(ApplicationInfo)(instance));
        instance.init(window);

        return instance;
    };

    if (instance.noMainWindow) {
        init(null);
    } else {
        init(manager.requestApplicationMainWindow(instance));
    }
};

const applicationRemoteLaunch = function(applicationMeta, applicationManager) {
    SystemHandlers.ApplicationHandler
        .remoteLaunch(applicationMeta.name)
        .then(instance => {
            logger.log(`launching ${applicationMeta.name}...`);

            if (!instanceList[applicationMeta.name]) {
                instanceList[applicationMeta.name] = [];
            }

            instanceList[applicationMeta.name].push(instance);

            return Promise.all([instance, fetchRemoteInstance(instance)]);
        }).then(([remoteInstance, instance]) => {
            logger.log(`Application ${applicationMeta.name} loaded!`);

            if(instance.isHeadless) {
                instance.init();

                return;
            }

            return applicationManager._windowManagerReady.then(() => {
                const mainWindow = instance.noMainWindow ? undefined : getSendableWindow(applicationManager.requestApplicationMainWindow(instance));

                applicationManager.emit('applicationLaunched', ApplicationInfo.new(instance));
                remoteInstance.init(mainWindow);
            });
        }).catch(e => logger.error(e));
};

const getSendableWindow = function(window) {
    const id = window._id;
    const application = window._app;

    return { id, application };
};

/**
 * @lends ApplicationInfo.prototype
 */
let ApplicationInfo = {
    name : null,
    displayName : null,
    icons : null,
    headless : false,

    /**
     * @constructs
     * @param {Application} application - the application from which the information should be extracted from.
     * @return {void}
     */
    _make(...args) {
        return this.constructor(...args);
    },

    constructor(application) {
        this.name = application.name;
        this.displayName = application.displayName;
        this.icons = application.icons ? application.icons.slice() : [];
        this.headless = application.headless;
        this.symbol = applicationSymbols.get(application);
    },

    new({ name, displayName, icons, headless, symbol }) {
        icons = icons ? icons.slice() : [];

        return { name, displayName, icons, headless, symbol, __proto__: this };
    }
};

const fetchRemoteInstance = function(remoteInstance) {
    return Promise.all([
        remoteInstance.name(),
        remoteInstance.displayName(),
        remoteInstance.icons(),
        remoteInstance.noMainWindow(),
        remoteInstance.headless(),
    ]).then(([name, displayName, icons, noMainWindow, headless]) => {
        return { name, displayName, icons, noMainWindow, headless };
    });
};

const ApplicationManager = {

    name: 'workbox.kernel.applicationmanager',

    _fakeWindow: null,
    _scope: null,
    _contentScope: null,
    _windowManagerReady: null,

    init() {
        super.constructor();

        this._scope = create(ViewController).constructor('main-view');

        this._windowManagerReady = new Promise((success) => {
            this.on('WindowManager', () => {
                windowManagerReady = true;
                success();
            });
        });

        // fake window
        const getScope = () => this._contentScope;

        this._fakeWindow = {
            viewPort: {
                bind: ({ template, view = {} }) => {
                    const viewController = create(ViewControllerProxied).constructor(template, view);

                    Promise.all([this._scope._id, viewController._id])
                        .then(([parentViewId, viewId]) => {
                            IOThread.attachView(parentViewId, viewId);
                        });

                    this._contentScope = viewController;
                },

                get scope() { return getScope(); },
                update: () => { this._contentScope.update(); }
            }
        };
    },

    updateWindowManager : function(newMethod){
        this.requestApplicationMainWindow = newMethod;
    },

    /**
     * requests a new window from the window manager. The default method creates a fake window with the main viewport.
     *
     * @return {Window} - a promise for the window creation.
     */
    requestApplicationMainWindow() {
        return this._fakeWindow;
    },

    /**
     * Registers a new application in the system
     *
     * @param {Application} application - the application which should be registered.
     * @return {ApplicationManager} - The ApplicationManager it self
     */
    register(application) {

        if (registeredApplications[application.name]) {
            logger.error(`Application "${application.name}" already exists!`);
            return;
        }

        registeredApplications[application.name] = application;
        applicationSymbols.set(application, Symbol(`ApplicationSymbol<${application.name}>`));

        if (application.resources) {
            Object.entries(application.resources)
                .forEach(([key, value]) => {
                    UrlResolver.packageResource(application.name, key, value);
                });
        }

        if (application.applicationMenu) {
            ApplicationMenuManager.registerMenu(applicationSymbols.get(application), application.applicationMenu);
        }

        logger.log(`Application ${application.name} registered!`);

        return ApplicationManager;
    },

    /**
     * launches an application by the given name
     *
     * @param {string} appName - the name of the application to launch.
     * @param {Application} source - the application which triggered the launch
     * @return {void}
     */
    launch(appName, source) {
        if (!registeredApplications[appName]) {
            return SystemHandlers.ErrorHandler.applicationNotAvailable(appName);
        }

        if (instanceList[appName] && instanceList[appName].length > 0) {
            logger.log(`Application ${appName} is already running!`);
            return;
        }

        if (registeredApplications[appName].remote) {
            return applicationRemoteLaunch(registeredApplications[appName], this);
        }

        const instance = Make(registeredApplications[appName])(source);

        logger.log(`launching ${appName}...`);

        if (!instanceList[appName]) {
            instanceList[appName] = [];
        }

        instanceList[appName].push(instance);

        if (!instance.headless && instance.rootView) {
            initApplication(instance, this);
        } else if(!instance.headless) {
            if (windowManagerReady) {
                initApplication(instance, this);
            } else {
                this.on('WindowManager', () => initApplication(instance, this));
            }
        } else {
            setTimeout(() => {
                logger.log(`Application ${appName} loaded!`);

                instance.init({});
            }, IMEDIATE_INVOCE);
        }
    },

    getInstances : function(appName) {
        return instanceList[appName];
    },

    getApplication : function(name) {
        const application = registeredApplications[name];

        return Make(ApplicationInfo)(application);
    },

    /**
     * @return {ApplicationInfo[]} - list of application info objects
     */
    getActiveApplicationList : function() {
        return Object.keys(instanceList).map(key => {
            let application = registeredApplications[key];

            return Make(ApplicationInfo)(application);
        });
    },

    __proto__: Application,
};

export default ApplicationManager.constructor();
